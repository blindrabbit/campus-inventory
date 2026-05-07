import { Router } from "express";
import { verifyJWT, requireRole } from "../middleware/auth.js";
import { requireInventoryAccess } from "../middleware/inventory.js";
import { prisma } from "../prisma/client.js";

const router = Router();

function formatHistoryEntry(entry, nameMap = {}) {
  return {
    id: entry.id,
    action: entry.action,
    reason: entry.reason,
    createdBy: nameMap[entry.createdBy] || entry.createdBy,
    createdAt: entry.createdAt,
    metadata: entry.metadata,
    fromSpaceId: entry.fromSpaceId,
    toSpaceId: entry.toSpaceId,
    fromSpaceName: entry.fromSpace?.name || null,
    toSpaceName: entry.toSpace?.name || null,
  };
}

async function buildNameMap(samAccountNames) {
  const unique = [...new Set(samAccountNames.filter(Boolean))];
  if (unique.length === 0) return {};
  const users = await prisma.user.findMany({
    where: { samAccountName: { in: unique } },
    select: { samAccountName: true, fullName: true },
  });
  return Object.fromEntries(users.map((u) => [u.samAccountName, u.fullName]));
}

router.get(
  "/unfound-items",
  verifyJWT,
  requireInventoryAccess(),
  requireRole("ADMIN"),
  async (req, res) => {
    try {
      const { fromSpaceId, conferente, action, fromDate, toDate } = req.query;
      const page = Math.max(Number(req.query.page || 1), 1);
      const limit = Math.min(Math.max(Number(req.query.limit || 20), 1), 100);

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
            select: { id: true, name: true, responsible: true },
          },
          relocationIn: {
            select: {
              pendingConfirm: true,
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
        )
          return false;
        if (action && latestAction !== action) return false;
        if (fromDate && latestDate < new Date(fromDate)) return false;
        if (toDate) {
          const end = new Date(toDate);
          end.setHours(23, 59, 59, 999);
          if (latestDate > end) return false;
        }

        return true;
      });

      const total = filtered.length;
      const start = (page - 1) * limit;
      const paginatedItems = filtered.slice(start, start + limit);

      // Resolve samAccountNames → fullName in a single query
      const allSamAccounts = paginatedItems.flatMap((item) => [
        item.ultimoConferente,
        ...item.history.map((h) => h.createdBy),
      ]);
      const nameMap = await buildNameMap(allSamAccounts);

      res.json({
        items: paginatedItems.map((item) => {
          const latestHistory = item.history[0];
          const isPendingMove = item.relocationIn?.pendingConfirm === true;
          const statusAtual = isPendingMove
            ? "MOVIDO_PENDENTE_ACEITE"
            : item.statusEncontrado === "NAO"
              ? "NAO_ENCONTRADO"
              : item.statusEncontrado;

          const conferenteSam = item.ultimoConferente || latestHistory?.createdBy || null;

          return {
            id: item.id,
            patrimonio: item.patrimonio,
            descricao: item.descricao,
            statusAtual,
            dataUltimaAlteracao:
              item.dataConferencia ||
              latestHistory?.createdAt ||
              item.updatedAt,
            ultimoResponsavel: nameMap[conferenteSam] || conferenteSam || null,
            ultimoLocalConhecido: item.space?.name || null,
            ultimoLocalConhecidoId: item.spaceId,
            conferente: nameMap[conferenteSam] || conferenteSam || null,
            historicoLocalizacoes: item.history.map((h) => formatHistoryEntry(h, nameMap)),
          };
        }),
        pagination: {
          page,
          limit,
          total,
          totalPages: Math.max(Math.ceil(total / limit), 1),
        },
      });
    } catch (err) {
      console.error("Error loading unfound audit items:", err);
      res.status(500).json({ error: "Erro ao carregar auditoria" });
    }
  },
);

router.get(
  "/space-movements",
  verifyJWT,
  requireInventoryAccess(),
  async (req, res) => {
    try {
      const { spaceId } = req.query;
      if (!spaceId) {
        return res.status(400).json({ error: "spaceId é obrigatório" });
      }

      const page = Math.max(Number(req.query.page || 1), 1);
      const limit = Math.min(Math.max(Number(req.query.limit || 20), 1), 100);

      const space = await prisma.space.findFirst({
        where: { id: spaceId, inventoryId: req.inventoryId },
        select: { id: true },
      });

      if (!space) {
        return res.status(404).json({ error: "Espaço não encontrado" });
      }

      const where = {
        item: { inventoryId: req.inventoryId },
        OR: [{ fromSpaceId: spaceId }, { toSpaceId: spaceId }],
      };

      const [total, history] = await Promise.all([
        prisma.itemHistorico.count({ where }),
        prisma.itemHistorico.findMany({
          where,
          include: {
            item: {
              select: {
                id: true,
                patrimonio: true,
                descricao: true,
              },
            },
            fromSpace: { select: { id: true, name: true } },
            toSpace: { select: { id: true, name: true } },
          },
          orderBy: { createdAt: "desc" },
          skip: (page - 1) * limit,
          take: limit,
        }),
      ]);

      const items = history.map((entry) => {
        const isEntry =
          entry.toSpaceId === spaceId && entry.fromSpaceId !== spaceId;
        const isExit =
          entry.fromSpaceId === spaceId && entry.toSpaceId !== spaceId;

        return {
          id: entry.id,
          itemId: entry.itemId,
          patrimonio: entry.item?.patrimonio || "-",
          descricao: entry.item?.descricao || "-",
          action: entry.action,
          direction: isEntry ? "ENTRADA" : isExit ? "SAIDA" : "INTERNO",
          fromSpaceName: entry.fromSpace?.name || null,
          toSpaceName: entry.toSpace?.name || null,
          createdBy: entry.createdBy,
          createdAt: entry.createdAt,
          reason: entry.reason,
        };
      });

      res.json({
        items,
        pagination: {
          page,
          limit,
          total,
          totalPages: Math.max(Math.ceil(total / limit), 1),
        },
      });
    } catch (err) {
      console.error("Error loading room movement history:", err);
      res.status(500).json({ error: "Erro ao carregar histórico da sala" });
    }
  },
);

router.get(
  "/items/:itemId/history",
  verifyJWT,
  requireInventoryAccess(),
  requireRole("ADMIN"),
  async (req, res) => {
    try {
      const { itemId } = req.params;

      const item = await prisma.item.findUnique({
        where: { id: itemId },
        include: {
          history: {
            include: {
              fromSpace: { select: { id: true, name: true } },
              toSpace: { select: { id: true, name: true } },
            },
            orderBy: { createdAt: "desc" },
          },
        },
      });

      if (!item) {
        return res.status(404).json({ error: "Item não encontrado" });
      }

      if (item.inventoryId !== req.inventoryId) {
        return res.status(403).json({ error: "Acesso negado ao inventário" });
      }

      res.json({
        item: {
          id: item.id,
          patrimonio: item.patrimonio,
          descricao: item.descricao,
        },
        history: item.history.map(formatHistoryEntry),
      });
    } catch (err) {
      console.error("Error loading item history:", err);
      res.status(500).json({ error: "Erro ao carregar histórico" });
    }
  },
);

export default router;
