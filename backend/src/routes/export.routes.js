import { Router } from "express";
import ExcelJS from "exceljs";
import { verifyJWT, requireRole } from "../middleware/auth.js";
import { requireInventoryAccess } from "../middleware/inventory.js";
import { prisma } from "../prisma/client.js";

const router = Router();

const toNodeBuffer = (value) =>
  Buffer.isBuffer(value) ? value : Buffer.from(value);

const INVENTORY_COLUMNS = [
  { header: "unidade", value: (item) => item.space?.unit || "" },
  { header: "setor", value: (item) => item.space?.sector || "" },
  { header: "responsavel", value: (item) => item.space?.responsible || "" },
  { header: "codigo", value: () => "" },
  { header: "descricao", value: (item) => item.descricao || "" },
  { header: "valor", value: (item) => formatCurrency(item.valor) },
  { header: "condicao", value: (item) => item.condicaoOriginal || "" },
  { header: "fornecedor", value: (item) => item.fornecedor || "" },
  { header: "cnpj_fornecedor", value: (item) => item.cnpjFornecedor || "" },
  { header: "catalogo", value: (item) => item.catalogo || "" },
  { header: "codigo_sia", value: (item) => item.codigoSIA || "" },
  { header: "descricao_sia", value: (item) => item.descricaoSIA || "" },
  { header: "patrimonio", value: (item) => item.patrimonio || "" },
  { header: "numero_entrada", value: (item) => item.numeroEntrada || "" },
  {
    header: "data_entrada",
    value: (item) => formatWorkbookDate(item.dataEntrada),
  },
  {
    header: "data_aquisicao",
    value: (item) => formatWorkbookDate(item.dataAquisicao),
  },
  { header: "documento", value: (item) => item.documento || "" },
  {
    header: "data_documento",
    value: (item) => formatWorkbookDate(item.dataDocumento),
  },
  { header: "tipo_aquisicao", value: (item) => item.tipoAquisicao || "" },
];

function formatCurrency(value) {
  if (value === null || value === undefined || value === "") return "";

  return new Intl.NumberFormat("pt-BR", {
    style: "currency",
    currency: "BRL",
  }).format(Number(value));
}

function formatWorkbookDate(value) {
  if (!value) return "";

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";

  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");

  return `${year}-${month}-${day} 00:00:00.000`;
}

function formatDateTime(value) {
  if (!value) return "";
  return new Date(value).toLocaleString("pt-BR");
}

function formatDate(value) {
  if (!value) return "";
  return new Date(value).toLocaleDateString("pt-BR");
}

function parseMetadata(metadata) {
  if (!metadata) return null;
  if (typeof metadata === "object") return metadata;

  try {
    return JSON.parse(metadata);
  } catch {
    return null;
  }
}

router.get("/xlsx", verifyJWT, requireInventoryAccess(), async (req, res) => {
  try {
    const items = await prisma.item.findMany({
      where: { inventoryId: req.inventoryId },
      include: {
        space: {
          select: {
            unit: true,
            sector: true,
            responsible: true,
          },
        },
      },
      orderBy: {
        patrimonio: "asc",
      },
    });

    const workbook = new ExcelJS.Workbook();
    const worksheet = workbook.addWorksheet("inventario");
    worksheet.addRow(INVENTORY_COLUMNS.map((column) => column.header));
    for (const item of items) {
      worksheet.addRow(INVENTORY_COLUMNS.map((column) => column.value(item)));
    }

    const buffer = toNodeBuffer(await workbook.xlsx.writeBuffer());
    const dateTag = new Date().toISOString().slice(0, 10).replace(/-/g, "");
    const fileName = `inventario_${dateTag}.xlsx`;

    res.setHeader(
      "Content-Type",
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    );
    res.setHeader("Content-Disposition", `attachment; filename=${fileName}`);

    return res.send(buffer);
  } catch (err) {
    console.error("Error exporting inventory XLSX:", err);
    return res.status(500).json({ error: "Erro ao exportar inventário" });
  }
});

router.get(
  "/audit-xlsx",
  verifyJWT,
  requireInventoryAccess(),
  requireRole("ADMIN"),
  async (req, res) => {
    try {
      const { fromSpaceId, conferente, action, fromDate, toDate } = req.query;

      const items = await prisma.item.findMany({
        where: {
          inventoryId: req.inventoryId,
          OR: [
            { statusEncontrado: "NAO" },
            { relocationIn: { is: { pendingConfirm: true } } },
          ],
        },
        include: {
          space: {
            select: {
              id: true,
              name: true,
              responsible: true,
              sector: true,
              unit: true,
            },
          },
          relocationIn: {
            include: {
              fromSpace: { select: { id: true, name: true } },
              toSpace: { select: { id: true, name: true } },
            },
          },
          history: {
            include: {
              fromSpace: { select: { id: true, name: true } },
              toSpace: { select: { id: true, name: true } },
            },
            orderBy: { createdAt: "desc" },
          },
        },
        orderBy: { updatedAt: "desc" },
      });

      const filtered = items.filter((item) => {
        const latestHistory = item.history[0];
        const latestAction = latestHistory?.action;
        const latestConferente =
          item.ultimoConferente || latestHistory?.createdBy || "";
        const latestDate =
          item.dataConferencia || latestHistory?.createdAt || item.updatedAt;
        const originSpaceId = item.lastKnownSpaceId || item.spaceId;

        if (fromSpaceId && originSpaceId !== fromSpaceId) return false;
        if (
          conferente &&
          !latestConferente
            .toLowerCase()
            .includes(conferente.toString().toLowerCase())
        ) {
          return false;
        }
        if (action && latestAction !== action) return false;
        if (fromDate && latestDate < new Date(fromDate)) return false;
        if (toDate) {
          const end = new Date(toDate);
          end.setHours(23, 59, 59, 999);
          if (latestDate > end) return false;
        }

        return true;
      });

      const rows = filtered.map((item) => {
        const latestHistory = item.history[0];
        const metadata = parseMetadata(latestHistory?.metadata);
        const isPendingMove = item.relocationIn?.pendingConfirm === true;

        const statusAtual = isPendingMove
          ? "Movido - pendente de aceite"
          : item.statusEncontrado === "NAO"
            ? "Não encontrado"
            : item.statusEncontrado;

        const timeline = item.history
          .map((entry) => {
            const parsedMeta = parseMetadata(entry.metadata);
            const details =
              parsedMeta && Object.keys(parsedMeta).length > 0
                ? ` | meta: ${JSON.stringify(parsedMeta)}`
                : "";

            return `${formatDateTime(entry.createdAt)} - ${entry.action} - ${
              entry.fromSpace?.name || "-"
            } -> ${entry.toSpace?.name || "-"} (${entry.createdBy || "-"})${details}`;
          })
          .join("\n");

        return {
          unidade: item.space?.unit || "",
          setor: item.space?.sector || "",
          responsavel: item.space?.responsible || "",
          descricao: item.descricao || "",
          valor: item.valor ?? "",
          condicao: item.condicaoOriginal || "",
          fornecedor: item.fornecedor || "",
          cnpj_fornecedor: item.cnpjFornecedor || "",
          catalogo: item.catalogo || "",
          codigo_sia: item.codigoSIA || "",
          descricao_sia: item.descricaoSIA || "",
          patrimonio: item.patrimonio || "",
          numero_entrada: item.numeroEntrada || "",
          data_entrada: formatDate(item.dataEntrada),
          data_aquisicao: formatDate(item.dataAquisicao),
          documento: item.documento || "",
          data_documento: formatDate(item.dataDocumento),
          tipo_aquisicao: item.tipoAquisicao || "",
          local_atual: item.space?.name || "",
          status_atual: statusAtual,
          data_ultima_alteracao: formatDateTime(
            item.dataConferencia || latestHistory?.createdAt || item.updatedAt,
          ),
          ultimo_responsavel:
            item.ultimoConferente || latestHistory?.createdBy || "",
          acao_mais_recente: latestHistory?.action || "",
          origem: latestHistory?.fromSpace?.name || "",
          destino: latestHistory?.toSpace?.name || "",
          motivo: latestHistory?.reason || "",
          metadata_mais_recente:
            metadata && Object.keys(metadata).length > 0
              ? JSON.stringify(metadata)
              : "",
          historico_localizacoes: timeline,
        };
      });

      const workbook = new ExcelJS.Workbook();
      const worksheet = workbook.addWorksheet("auditoria");

      const columns = rows.length > 0 ? Object.keys(rows[0]) : [];
      worksheet.columns = columns.map((column) => ({
        header: column,
        key: column,
      }));

      for (const row of rows) {
        worksheet.addRow(row);
      }

      const buffer = toNodeBuffer(await workbook.xlsx.writeBuffer());
      const dateTag = new Date().toISOString().slice(0, 10).replace(/-/g, "");
      const fileName = `inventario_auditoria_${dateTag}.xlsx`;

      res.setHeader(
        "Content-Type",
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      );
      res.setHeader("Content-Disposition", `attachment; filename=${fileName}`);

      return res.send(buffer);
    } catch (err) {
      console.error("Error exporting audit XLSX:", err);
      return res.status(500).json({ error: "Erro ao exportar auditoria" });
    }
  },
);

export default router;
