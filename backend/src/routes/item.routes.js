import { Router } from "express";
import multer from "multer";
import ExcelJS from "exceljs";
import { verifyJWT } from "../middleware/auth.js";
import {
  requireInventoryAccess,
  requireInventoryOperationalWrite,
  requireInventoryWriteAccess,
  requireVerificationAccess,
} from "../middleware/inventory.js";
import { prisma } from "../prisma/client.js";
import { recordItemHistory } from "../services/audit.js";
import { broadcast } from "../services/sse.js";
import { recomputeSpaceCounters } from "../services/metrics.js";

const router = Router();

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 20 * 1024 * 1024 },
});

// Índices de coluna do export do sistema de biblioteca (1-based)
const BOOK_COL = {
  CODIGO_BARRAS:   2,   // B
  CODIGO_EXEMPLAR: 3,   // C
  NUMERO_EXEMPLAR: 16,  // P
  PATRIMONIO:      32,  // AF
  TITULO:          34,  // AH
  AUTORES:         53,  // BA
  ANO_PUBLICACAO:  59,  // BG
};

function bookCellText(row, colIndex) {
  if (!colIndex) return null;
  const cell = row.getCell(colIndex);
  const v = cell.value;
  if (v === null || v === undefined) return null;
  if (typeof v === "object") {
    return (
      String(
        v.text ??
          v.result ??
          (Array.isArray(v.richText)
            ? v.richText.map((part) => part.text).join("")
            : ""),
      ).trim() || null
    );
  }
  return String(v).trim() || null;
}

function normalizeHeader(value) {
  return normalizeString(value).replace(/[^a-z0-9]+/g, " ").trim();
}

function detectBookColumns(worksheet) {
  const headers = new Map();
  worksheet.getRow(1).eachCell({ includeEmpty: false }, (cell, colIndex) => {
    const normalized = normalizeHeader(cell.value?.toString() || "");
    if (normalized) headers.set(normalized, colIndex);
  });

  const findHeader = (...aliases) => {
    for (const alias of aliases) {
      const match = headers.get(normalizeHeader(alias));
      if (match) return match;
    }
    return null;
  };

  let maxCol = 0;
  worksheet.getRow(1).eachCell({ includeEmpty: false }, (_, colIndex) => {
    if (colIndex > maxCol) maxCol = colIndex;
  });

  return {
    codigoBarras:
      findHeader(
        "exemplar",
        "codigo de barras",
        "código de barras",
        "codigo barras",
      ) || BOOK_COL.CODIGO_BARRAS,
    patrimonio:
      findHeader(
        "numero do patrimonio",
        "número do patrimônio",
        "patrimonio",
        "patrimônio",
      ) || BOOK_COL.PATRIMONIO,
    titulo: findHeader("titulo", "título", "titulo n") || BOOK_COL.TITULO,
    codigoExemplar:
      findHeader(
        "codigo do acervo",
        "código do acervo",
        "codigo exemplar",
        "código exemplar",
        "codigo do exemplar",
      ) || BOOK_COL.CODIGO_EXEMPLAR,
    numeroExemplar:
      findHeader("numero do exemplar", "número do exemplar") ||
      BOOK_COL.NUMERO_EXEMPLAR,
    autores: findHeader("autor", "autores") || BOOK_COL.AUTORES,
    anoPublicacao:
      findHeader("ano", "ano publicacao", "ano publicação") ||
      BOOK_COL.ANO_PUBLICACAO,
    catalogo:
      findHeader("classificacao", "classificação", "codigo do acervo") || null,
    codigoRFID:
      findHeader("rfid", "codigo rfid", "código rfid") ||
      (maxCol > BOOK_COL.ANO_PUBLICACAO ? maxCol : null),
  };
}

function normalizePatrimonioNumber(value) {
  if (value === null || value === undefined) return null;
  const digits = value.toString().trim().replace(/\D/g, "");
  if (!digits) return null;
  const parsed = Number.parseInt(digits, 10);
  if (Number.isNaN(parsed)) return null;
  return parsed;
}

function normalizeString(str) {
  if (!str) return "";
  return str
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim();
}

function isMissingDuplicateSchemaError(err) {
  const message = `${err?.message || ""} ${err?.meta?.column || ""}`;
  return (
    err?.code === "P2022" ||
    message.includes("is_duplicate_suspect") ||
    message.includes("duplicate_notes") ||
    message.includes("duplicate_observed_space_id") ||
    message.includes("isDuplicateSuspect") ||
    message.includes("duplicateObservedSpaceId")
  );
}

function roomItemSelect({ includeDuplicateObserved = true } = {}) {
  return {
    id: true,
    patrimonio: true,
    descricao: true,
    condicaoOriginal: true,
    valor: true,
    codigoSIA: true,
    fornecedor: true,
    dataAquisicao: true,
    documento: true,
    codigoBarras: true,
    codigoRFID: true,
    autores: true,
    anoPublicacao: true,
    numeroExemplar: true,
    spaceId: true,
    statusEncontrado: true,
    condicaoVisual: true,
    dataConferencia: true,
    ultimoConferente: true,
    verificationStatus: true,
    verifiedAt: true,
    verifiedBy: true,
    isDuplicateSuspect: true,
    duplicateNotes: true,
    ...(includeDuplicateObserved ? { duplicateObservedSpaceId: true } : {}),
    space: { select: { id: true, name: true } },
    relocationIn: {
      select: {
        fromSpace: { select: { name: true } },
        movedBy: true,
        pendingConfirm: true,
        wasUnfound: true,
      },
    },
    itemGroup: { select: { id: true, name: true } },
  };
}

function legacyRoomItemSelect() {
  const { isDuplicateSuspect, duplicateNotes, duplicateObservedSpaceId, ...select } =
    roomItemSelect({ includeDuplicateObserved: false });
  return select;
}

function formatRoomItems(items, spaceId) {
  return items.map((item) => {
    const duplicateObservedSpaceId = item.duplicateObservedSpaceId || null;
    const duplicateMirrorMeta =
      item.spaceId !== spaceId && duplicateObservedSpaceId === spaceId
        ? {
            isDuplicateMirror: true,
            originalSpaceId: item.spaceId,
            originalSpaceName: item.space?.name || null,
          }
        : null;
    const relocationMeta = item.relocationIn
      ? {
          isRelocated: item.relocationIn.pendingConfirm,
          fromSpaceName: item.relocationIn.fromSpace.name,
          movedBy: item.relocationIn.movedBy,
          pendingConfirm: item.relocationIn.pendingConfirm,
          wasUnfound: item.relocationIn.wasUnfound,
        }
      : null;

    return {
      id: item.id,
      patrimonio: item.patrimonio,
      descricao: item.descricao,
      condicaoOriginal: item.condicaoOriginal,
      valor: item.valor,
      codigoSIA: item.codigoSIA,
      fornecedor: item.fornecedor,
      dataAquisicao: item.dataAquisicao,
      documento: item.documento,
      codigoBarras: item.codigoBarras,
      codigoRFID: item.codigoRFID,
      autores: item.autores,
      anoPublicacao: item.anoPublicacao,
      numeroExemplar: item.numeroExemplar,
      statusEncontrado: item.statusEncontrado,
      condicaoVisual: item.condicaoVisual,
      dataConferencia: item.dataConferencia,
      ultimoConferente: item.ultimoConferente,
      verificationStatus: item.verificationStatus,
      verifiedAt: item.verifiedAt,
      verifiedBy: item.verifiedBy,
      isDuplicateSuspect: Boolean(item.isDuplicateSuspect),
      duplicateNotes: item.duplicateNotes || null,
      duplicateObservedSpaceId,
      duplicateOriginSpaceId: item.spaceId,
      duplicateOriginSpaceName: item.space?.name || null,
      itemGroupId: item.itemGroup?.id || null,
      groupName: item.itemGroup?.name || null,
      meta:
        relocationMeta || duplicateMirrorMeta
          ? { ...(relocationMeta || {}), ...(duplicateMirrorMeta || {}) }
          : null,
    };
  });
}

function searchItemSelect({ includeDuplicateFields = true } = {}) {
  return {
    id: true,
    patrimonio: true,
    descricao: true,
    codigoBarras: true,
    codigoRFID: true,
    autores: true,
    spaceId: true,
    statusEncontrado: true,
    ...(includeDuplicateFields
      ? {
          isDuplicateSuspect: true,
          duplicateNotes: true,
          duplicateObservedSpaceId: true,
        }
      : {}),
    space: {
      select: {
        id: true,
        name: true,
        isFinalized: true,
        isVerifiedByRevisor: true,
      },
    },
    itemGroupId: true,
    itemGroup: {
      select: {
        id: true,
        name: true,
        _count: { select: { items: true } },
      },
    },
  };
}

function scoreAndMapSearchResults(items, query) {
  const normalizedQuery = normalizeString(query);
  const queryAsNumber = normalizePatrimonioNumber(query);

  return items
    .map((item) => {
      const normalizedPatrimonio = normalizeString(item.patrimonio || "");
      const normalizedCodigoBarras = normalizeString(item.codigoBarras || "");
      const normalizedCodigoRFID = normalizeString(item.codigoRFID || "");
      const normalizedDescricao = normalizeString(item.descricao || "");
      const normalizedAutores = normalizeString(item.autores || "");
      const itemPatrimonioNumber = normalizePatrimonioNumber(item.patrimonio);
      const itemCodigoBarrasNumber = normalizePatrimonioNumber(item.codigoBarras);

      let priority = 999;
      if (
        queryAsNumber !== null &&
        itemCodigoBarrasNumber !== null &&
        itemCodigoBarrasNumber === queryAsNumber
      ) {
        priority = 0;
      } else if (
        queryAsNumber !== null &&
        itemPatrimonioNumber !== null &&
        itemPatrimonioNumber === queryAsNumber
      ) {
        priority = 1;
      } else if (normalizedCodigoBarras === normalizedQuery) {
        priority = 2;
      } else if (normalizedCodigoRFID === normalizedQuery) {
        priority = 3;
      } else if (normalizedPatrimonio === normalizedQuery) {
        priority = 3;
      } else if (normalizedCodigoBarras.startsWith(normalizedQuery)) {
        priority = 4;
      } else if (normalizedPatrimonio.startsWith(normalizedQuery)) {
        priority = 5;
      } else if (normalizedCodigoBarras.includes(normalizedQuery)) {
        priority = 6;
      } else if (normalizedPatrimonio.includes(normalizedQuery)) {
        priority = 7;
      } else if (normalizedDescricao.startsWith(normalizedQuery)) {
        priority = 8;
      } else if (normalizedDescricao.includes(normalizedQuery)) {
        priority = 9;
      } else if (normalizedAutores.includes(normalizedQuery)) {
        priority = 10;
      }

      return { item, priority };
    })
    .filter((scored) => scored.priority !== 999)
    .sort((a, b) => {
      if (a.priority !== b.priority) {
        return a.priority - b.priority;
      }
      const aNum = normalizePatrimonioNumber(a.item.patrimonio);
      const bNum = normalizePatrimonioNumber(b.item.patrimonio);
      if (aNum !== null && bNum !== null) {
        return aNum - bNum;
      }
      return (a.item.patrimonio || "").localeCompare(
        b.item.patrimonio || "",
        "pt-BR",
        {
          numeric: true,
        },
      );
    })
    .slice(0, 20)
    .map(({ item }) => ({
      id: item.id,
      patrimonio: item.patrimonio,
      codigoBarras: item.codigoBarras,
      codigoRFID: item.codigoRFID,
      descricao: item.descricao,
      spaceId: item.spaceId,
      spaceName: item.space?.name || "Sem localização",
      statusEncontrado: item.statusEncontrado,
      isDuplicateSuspect: Boolean(item.isDuplicateSuspect),
      duplicateNotes: item.duplicateNotes || null,
      duplicateObservedSpaceId: item.duplicateObservedSpaceId || null,
      spaceIsFinalized: item.space?.isFinalized || false,
      spaceIsVerifiedByRevisor: item.space?.isVerifiedByRevisor || false,
      itemGroupId: item.itemGroupId || null,
      itemGroup: item.itemGroup
        ? {
            id: item.itemGroup.id,
            name: item.itemGroup.name,
            totalItems: item.itemGroup._count.items,
          }
        : null,
    }));
}

async function markSpaceStarted(prismaClient, { inventoryId, spaceId, user }) {
  if (!inventoryId || !spaceId || !user?.sub) return;

  try {
    await prismaClient.space.updateMany({
      where: {
        id: spaceId,
        inventoryId,
        startedAt: null,
        isFinalized: false,
      },
      data: {
        startedAt: new Date(),
        startedBy: user.fullName || user.sub,
      },
    });
  } catch (err) {
    const message = err?.message || "";
    // Runtime fallback: some environments still run an older Prisma Client.
    if (message.includes("Unknown argument `startedAt`")) {
      console.warn(
        "[SPACE] startedAt/startedBy not available in current Prisma Client; skipping start marker update.",
      );
      return;
    }
    throw err;
  }

  // Auto-transition inventory from NAO_INICIADO → EM_EXECUCAO on first activity
  try {
    await prismaClient.inventory.updateMany({
      where: { id: inventoryId, statusOperacao: "NAO_INICIADO" },
      data: { statusOperacao: "EM_EXECUCAO" },
    });
  } catch (_) {
    // Non-critical: status stays as-is if this fails
  }
}

router.get("/", verifyJWT, requireInventoryAccess(), async (req, res) => {
  try {
    const { spaceId } = req.query;
    if (!spaceId)
      return res.status(400).json({ error: "spaceId é obrigatório" });

    const space = await prisma.space.findFirst({
      where: {
        id: spaceId,
        inventoryId: req.inventoryId,
        ...(req.user?.role === "ADMIN" || req.inventoryRole === "ADMIN_CICLO"
          ? {}
          : { isActive: true }),
      },
      select: { id: true },
    });

    if (!space) {
      return res.status(404).json({ error: "Espaço não encontrado" });
    }

    const items = await prisma.item.findMany({
      where: {
        inventoryId: req.inventoryId,
        statusEncontrado: { not: "NAO" },
        OR: [
          { spaceId },
          { isDuplicateSuspect: true, duplicateObservedSpaceId: spaceId },
        ],
      },
      select: roomItemSelect(),
    });

    const formatted = formatRoomItems(items, spaceId);

    res.json(formatted);
  } catch (err) {
    if (isMissingDuplicateSchemaError(err)) {
      try {
        console.warn(
          "[items] Duplicate columns are not available yet; loading room items without duplicate mirror support.",
        );
        const { spaceId } = req.query;
        const items = await prisma.item.findMany({
          where: {
            inventoryId: req.inventoryId,
            spaceId,
            statusEncontrado: { not: "NAO" },
          },
          select: legacyRoomItemSelect(),
        });
        return res.json(formatRoomItems(items, spaceId));
      } catch (fallbackErr) {
        console.error("Error fetching items with legacy fallback:", fallbackErr);
      }
    }
    console.error("Error fetching items:", err);
    res.status(500).json({ error: "Erro ao carregar itens" });
  }
});

router.get("/all", verifyJWT, requireInventoryAccess(), async (req, res) => {
  try {
      const items = await prisma.item.findMany({
        where: { inventoryId: req.inventoryId },
        select: searchItemSelect(),
        orderBy: { patrimonio: "asc" },
      });

      res.json(items);
    } catch (err) {
      if (isMissingDuplicateSchemaError(err)) {
        try {
          console.warn(
            "[items/all] Duplicate columns are not available yet; loading without duplicate metadata.",
          );
          const items = await prisma.item.findMany({
            where: { inventoryId: req.inventoryId },
            select: searchItemSelect({ includeDuplicateFields: false }),
            orderBy: { patrimonio: "asc" },
          });
          return res.json(
            items.map((item) => ({
              ...item,
              isDuplicateSuspect: false,
              duplicateNotes: null,
              duplicateObservedSpaceId: null,
            })),
          );
        } catch (fallbackErr) {
          console.error("Error fetching all items with legacy fallback:", fallbackErr);
        }
      }
      console.error("Error fetching all items:", err);
      res.status(500).json({ error: "Erro ao carregar itens" });
    }
  });

router.get("/search", verifyJWT, requireInventoryAccess(), async (req, res) => {
  try {
    const q = req.query.q?.toString().trim();
    const excludeSpaceId = req.query.excludeSpaceId?.toString();

    if (!q || q.length < 2) {
      return res
        .status(400)
        .json({ error: "Informe ao menos 2 caracteres para busca" });
    }

    const where = {
      inventoryId: req.inventoryId,
      ...(excludeSpaceId ? { NOT: { spaceId: excludeSpaceId } } : {}),
    };

    const matches = await prisma.item.findMany({
      where,
      select: searchItemSelect(),
    });

    res.json(scoreAndMapSearchResults(matches, q));
  } catch (err) {
    if (isMissingDuplicateSchemaError(err)) {
      try {
        const q = req.query.q?.toString().trim();
        const excludeSpaceId = req.query.excludeSpaceId?.toString();
        const where = {
          inventoryId: req.inventoryId,
          ...(excludeSpaceId ? { NOT: { spaceId: excludeSpaceId } } : {}),
        };
        console.warn(
          "[items/search] Duplicate columns are not available yet; searching without duplicate metadata.",
        );
        const matches = await prisma.item.findMany({
          where,
          select: searchItemSelect({ includeDuplicateFields: false }),
        });
        return res.json(scoreAndMapSearchResults(matches, q));
      } catch (fallbackErr) {
        console.error("Error searching items with legacy fallback:", fallbackErr);
      }
    }
    console.error("Error searching items:", err);
    res.status(500).json({ error: "Erro ao buscar patrimônios" });
  }
});

router.post(
  "/check",
  verifyJWT,
  requireInventoryAccess(),
  requireInventoryWriteAccess(),
  requireInventoryOperationalWrite(),
  async (req, res) => {
    try {
      const { itemId, condicao, connectionId } = req.body;
      const user = req.user;

      console.log(
        `[CHECK] Starting item check for itemId=${itemId}, condicao=${condicao}, user=${user.sub}`,
      );

      const item = await prisma.item.findUnique({
        where: { id: itemId },
        select: {
          id: true,
          spaceId: true,
          inventoryId: true,
          lastKnownSpaceId: true,
        },
      });

      if (!item || item.inventoryId !== req.inventoryId) {
        console.log(
          `[CHECK] Item not found or wrong inventory: item=${JSON.stringify(item)}, inventoryId=${req.inventoryId}`,
        );
        return res.status(404).json({ error: "Item não encontrado" });
      }

      console.log(
        `[CHECK] Item found: id=${item.id}, spaceId=${item.spaceId}, lastKnownSpaceId=${item.lastKnownSpaceId}`,
      );

      // Executar tudo em transação para garantir consistência
      await prisma.$transaction(async (tx) => {
        // 1. Atualizar item como encontrado
        console.log(`[CHECK] Updating item status to SIM`);
        const checked = await tx.item.updateMany({
          where: { id: itemId, inventoryId: req.inventoryId },
          data: {
            statusEncontrado: "SIM",
            condicaoVisual: condicao || null,
            dataConferencia: new Date(),
            ultimoConferente: user.sub,
          },
        });

        if (checked.count === 0) {
          throw new Error("Item não encontrado para atualização");
        }

        console.log(`[CHECK] Item updated: ${checked.count} records`);

        // 2. Marcar relocação como confirmada (se houver)
        console.log(`[CHECK] Checking for pending relocations`);
        const relocUpdated = await tx.relocation.updateMany({
          where: { itemId, pendingConfirm: true },
          data: { pendingConfirm: false },
        });
        console.log(
          `[CHECK] Relocations updated: ${relocUpdated.count} records`,
        );

        // 3. Registrar no histórico
        console.log(`[CHECK] Recording item history`);
        const historyData = {
          itemId,
          fromSpaceId: item.lastKnownSpaceId || item.spaceId,
          toSpaceId: item.spaceId,
          action: "ENCONTRADO",
          createdBy: user.sub,
          metadata: condicao ? JSON.stringify({ condicao }) : null,
        };
        console.log(`[CHECK] History data:`, JSON.stringify(historyData));

        await recordItemHistory(tx, historyData);
        console.log(`[CHECK] History recorded`);

        // 4. A marcação de início da sala é feita fora da transação via markSpaceStarted.
      });

      await markSpaceStarted(prisma, {
        inventoryId: req.inventoryId,
        spaceId: item.spaceId,
        user,
      });

      console.log(`[CHECK] Transaction completed successfully`);

      // Build excludeClientId from inventoryId + userId + connectionId to exclude only this session
      const excludeClientId = connectionId
        ? `${req.inventoryId}:${user.sub}:${connectionId}`
        : undefined;

      // Notify other users watching this space
      broadcast({
        inventoryId: req.inventoryId,
        spaceId: item.spaceId,
        action: "item_checked",
        excludeClientId,
        payload: {
          itemId,
          spaceId: item.spaceId,
          action: "ENCONTRADO",
          user: user.fullName || user.sub,
          timestamp: new Date(),
        },
      });

      // Recompute counters for the affected space (best-effort)
      try {
        await recomputeSpaceCounters(item.spaceId, req.inventoryId);
      } catch (err) {
        console.warn(
          "Failed to recompute counters after check:",
          err.message || err,
        );
      }

      res.json({ success: true, savedAt: new Date() });
    } catch (err) {
      console.error("[CHECK] ERROR:", err.message || err);
      console.error("[CHECK] STACK:", err.stack || "no stack");
      res
        .status(500)
        .json({ error: "Erro ao confirmar item", details: err.message });
    }
  },
);

router.post(
  "/relocate",
  verifyJWT,
  requireInventoryAccess(),
  requireInventoryWriteAccess(),
  requireInventoryOperationalWrite(),
  async (req, res) => {
    try {
      const { itemId, targetSpaceId, groupMoveCount, connectionId } = req.body;
      const user = req.user;

      const item = await prisma.item.findUnique({
        where: { id: itemId },
        select: {
          id: true,
          spaceId: true,
          lastKnownSpaceId: true,
          inventoryId: true,
          statusEncontrado: true,
          patrimonio: true,
          descricao: true,
        },
      });

      if (!item || item.inventoryId !== req.inventoryId) {
        return res.status(404).json({ error: "Item não encontrado" });
      }

      const targetSpace = await prisma.space.findFirst({
        where: { id: targetSpaceId, inventoryId: req.inventoryId, isActive: true },
        select: { id: true, name: true, isFinalized: true },
      });

      if (!targetSpace) {
        return res.status(400).json({ error: "Espaço de destino inválido" });
      }

      if (targetSpace.isFinalized) {
        return res
          .status(409)
          .json({
            error: "A sala de destino está finalizada e não pode receber itens",
          });
      }

      const sourceSpace = await prisma.space.findUnique({
        where: { id: item.spaceId },
        select: { id: true, name: true, isFinalized: true },
      });
      if (sourceSpace?.isFinalized && item.statusEncontrado !== "NAO") {
        return res
          .status(409)
          .json({
            error: "Esta sala está finalizada e não pode ter itens removidos",
          });
      }

      if (item.spaceId === targetSpaceId) {
        // Caso especial: item marcado como NAO sendo "devolvido" ao seu próprio espaço
        // — interpreta como desfazer o não-localizado, voltando para PENDENTE
        if (item.statusEncontrado === "NAO") {
          await prisma.$transaction(async (tx) => {
            await tx.item.updateMany({
              where: { id: itemId, inventoryId: req.inventoryId },
              data: { statusEncontrado: "PENDENTE" },
            });
            await recordItemHistory(tx, {
              itemId,
              fromSpaceId: item.spaceId,
              toSpaceId: item.spaceId,
              action: "DESFEITO_NAO_LOCALIZADO",
              createdBy: user.sub,
            });
          });

          const excludeClientId = connectionId
            ? `${req.inventoryId}:${user.sub}:${connectionId}`
            : undefined;

          broadcast({
            inventoryId: req.inventoryId,
            spaceId: item.spaceId,
            action: "item_restored",
            excludeClientId,
            payload: {
              itemId,
              patrimonio: item.patrimonio,
              descricao: item.descricao,
              spaceId: item.spaceId,
              action: "DESFEITO_NAO_LOCALIZADO",
              user: user.fullName || user.sub,
              timestamp: new Date(),
            },
          });

          try {
            await recomputeSpaceCounters(item.spaceId, req.inventoryId);
          } catch (err) {
            console.warn("Failed to recompute counters after undo-unfound:", err.message || err);
          }

          return res.json({ success: true, undidUnfound: true, message: "Marcação 'não localizado' desfeita — item retornou para pendente" });
        }

        return res
          .status(400)
          .json({ error: "O item já está no espaço de destino informado" });
      }

      const movedAt = new Date();

      await prisma.$transaction(async (tx) => {
        // Validar que não estamos movendo para o mesmo espaço
        if (item.spaceId === targetSpaceId) {
          throw new Error("Item já está neste espaço");
        }

        await tx.item.updateMany({
          where: { id: itemId, inventoryId: req.inventoryId },
          data: {
            spaceId: targetSpaceId,
            lastKnownSpaceId: item.spaceId,
            statusEncontrado: "PENDENTE",
          },
        });

        const wasUnfound = item.statusEncontrado === "NAO";
        await tx.relocation.upsert({
          where: { itemId },
          create: {
            itemId,
            fromSpaceId: item.spaceId,
            toSpaceId: targetSpaceId,
            movedBy: user.sub,
            movedAt,
            pendingConfirm: true,
            wasUnfound,
          },
          update: {
            fromSpaceId: item.spaceId,
            toSpaceId: targetSpaceId,
            movedBy: user.sub,
            movedAt,
            pendingConfirm: true,
            wasUnfound,
          },
        });

        await recordItemHistory(tx, {
          itemId,
          fromSpaceId: item.spaceId,
          toSpaceId: targetSpaceId,
          action: "REALOCADO",
          createdBy: user.sub,
          metadata:
            groupMoveCount != null
              ? JSON.stringify({ groupMoveCount: Number(groupMoveCount) })
              : null,
        });
      });

      console.log(
        `[RELOCATE] Item ${itemId} moved from space ${item.spaceId} to ${targetSpaceId}`,
      );

      // Build excludeClientId from inventoryId + userId + connectionId to exclude only this session
      const excludeClientId = connectionId
        ? `${req.inventoryId}:${user.sub}:${connectionId}`
        : undefined;

      // Notify users in the DESTINATION space that an item was moved there
      broadcast({
        inventoryId: req.inventoryId,
        spaceId: targetSpaceId,
        action: "item_relocated",
        excludeClientId,
        payload: {
          itemId,
          patrimonio: item.patrimonio,
          descricao: item.descricao,
          fromSpaceId: item.spaceId,
          fromSpaceName: sourceSpace?.name,
          toSpaceId: targetSpaceId,
          toSpaceName: targetSpace.name,
          user: user.fullName || user.sub,
          timestamp: movedAt,
        },
      });

      // Notify users in the SOURCE space that an item left
      broadcast({
        inventoryId: req.inventoryId,
        spaceId: item.spaceId,
        action: "item_left_space",
        excludeClientId,
        payload: {
          itemId,
          patrimonio: item.patrimonio,
          descricao: item.descricao,
          fromSpaceId: item.spaceId,
          fromSpaceName: sourceSpace?.name,
          toSpaceId: targetSpaceId,
          toSpaceName: targetSpace.name,
          user: user.fullName || user.sub,
          timestamp: movedAt,
        },
      });

      // Recompute counters for source and destination spaces
      try {
        await recomputeSpaceCounters(targetSpaceId, req.inventoryId);
        await recomputeSpaceCounters(item.spaceId, req.inventoryId);
      } catch (err) {
        console.warn(
          "Failed to recompute counters after relocate:",
          err.message || err,
        );
      }

      res.json({
        success: true,
        message: "Item realocado - aguardando confirmação no destino",
      });
    } catch (err) {
      console.error("Error relocating item:", err);
      res.status(500).json({ error: "Erro ao realocar item" });
    }
  },
);

router.post(
  "/planned-relocations",
  verifyJWT,
  requireInventoryAccess(),
  requireInventoryWriteAccess(),
  requireInventoryOperationalWrite(),
  async (req, res) => {
    try {
      const { movements, reason, connectionId } = req.body;
      const user = req.user;

      if (user?.role !== "ADMIN" && req.inventoryRole !== "ADMIN_CICLO") {
        return res.status(403).json({
          error:
            "Apenas administradores do ciclo podem realizar movimentações planejadas",
        });
      }

      if (!Array.isArray(movements) || movements.length === 0) {
        return res.status(400).json({
          error: "Informe ao menos uma movimentação para executar",
        });
      }

      if (movements.length > 500) {
        return res.status(400).json({
          error: "Limite de 500 movimentações por operação",
        });
      }

      const normalizedMovements = movements.map((movement) => ({
        itemId: movement?.itemId?.toString(),
        targetSpaceId: movement?.targetSpaceId?.toString(),
      }));

      if (
        normalizedMovements.some(
          (movement) => !movement.itemId || !movement.targetSpaceId,
        )
      ) {
        return res.status(400).json({
          error: "Cada movimentação precisa ter patrimônio e sala de destino",
        });
      }

      const itemIds = normalizedMovements.map((movement) => movement.itemId);
      const targetSpaceIds = [
        ...new Set(normalizedMovements.map((movement) => movement.targetSpaceId)),
      ];
      const repeatedItemIds = itemIds.filter(
        (itemId, index) => itemIds.indexOf(itemId) !== index,
      );

      if (repeatedItemIds.length > 0) {
        return res.status(400).json({
          error:
            "Um mesmo patrimônio não pode aparecer mais de uma vez na lista",
        });
      }

      const [items, targetSpaces] = await Promise.all([
        prisma.item.findMany({
          where: { id: { in: itemIds }, inventoryId: req.inventoryId },
          select: {
            id: true,
            patrimonio: true,
            descricao: true,
            spaceId: true,
            statusEncontrado: true,
            inventoryId: true,
            space: {
              select: {
                id: true,
                name: true,
                isFinalized: true,
              },
            },
          },
        }),
        prisma.space.findMany({
          where: {
            id: { in: targetSpaceIds },
            inventoryId: req.inventoryId,
            isActive: true,
          },
          select: {
            id: true,
            name: true,
            isFinalized: true,
          },
        }),
      ]);

      const itemsById = new Map(items.map((item) => [item.id, item]));
      const spacesById = new Map(targetSpaces.map((space) => [space.id, space]));
      const missingItem = normalizedMovements.find(
        (movement) => !itemsById.has(movement.itemId),
      );
      const missingSpace = normalizedMovements.find(
        (movement) => !spacesById.has(movement.targetSpaceId),
      );

      if (missingItem) {
        return res.status(404).json({ error: "Patrimônio não encontrado" });
      }
      if (missingSpace) {
        return res.status(400).json({ error: "Sala de destino inválida" });
      }

      const sameSpaceMovement = normalizedMovements.find((movement) => {
        const item = itemsById.get(movement.itemId);
        return item?.spaceId === movement.targetSpaceId;
      });

      if (sameSpaceMovement) {
        const item = itemsById.get(sameSpaceMovement.itemId);
        return res.status(400).json({
          error: `O patrimônio ${item?.patrimonio || item?.descricao || item?.id} já está na sala de destino`,
        });
      }

      const hasFinalizedSpace = normalizedMovements.some((movement) => {
        const item = itemsById.get(movement.itemId);
        const targetSpace = spacesById.get(movement.targetSpaceId);
        return item?.space?.isFinalized || targetSpace?.isFinalized;
      });

      if (hasFinalizedSpace && !reason?.toString().trim()) {
        return res.status(400).json({
          error:
            "Informe uma justificativa para movimentar itens envolvendo sala lacrada",
        });
      }

      const movedAt = new Date();
      const sourceSpaceIds = [...new Set(items.map((item) => item.spaceId))];
      const affectedSpaceIds = [
        ...new Set([...sourceSpaceIds, ...targetSpaceIds]),
      ];
      const movementByItemId = new Map(
        normalizedMovements.map((movement) => [movement.itemId, movement]),
      );
      const relocationData = items.map((item) => {
        const movement = movementByItemId.get(item.id);
        return {
          itemId: item.id,
          fromSpaceId: item.spaceId,
          toSpaceId: movement.targetSpaceId,
          movedBy: user.sub,
          movedAt,
          pendingConfirm: true,
          wasUnfound: item.statusEncontrado === "NAO",
        };
      });

      await prisma.$transaction(async (tx) => {
        for (const item of items) {
          const movement = movementByItemId.get(item.id);
          await tx.item.updateMany({
            where: { id: item.id, inventoryId: req.inventoryId },
            data: {
              spaceId: movement.targetSpaceId,
              lastKnownSpaceId: item.spaceId,
              statusEncontrado: "PENDENTE",
            },
          });
        }

        await tx.relocation.deleteMany({ where: { itemId: { in: itemIds } } });
        await tx.relocation.createMany({ data: relocationData });
        await tx.itemHistorico.createMany({
          data: items.map((item) => {
            const movement = movementByItemId.get(item.id);
            const targetSpace = spacesById.get(movement.targetSpaceId);
            return {
              itemId: item.id,
              fromSpaceId: item.spaceId,
              toSpaceId: movement.targetSpaceId,
              action: "REALOCADO",
              reason:
                reason?.toString().trim() ||
                "Movimentação planejada entre salas",
              createdBy: user.sub,
              createdAt: movedAt,
              metadata: JSON.stringify({
                source: "planned-relocation",
                reason: reason?.toString().trim() || null,
                sourceSpaceFinalized: Boolean(item.space?.isFinalized),
                targetSpaceFinalized: Boolean(targetSpace?.isFinalized),
              }),
            };
          }),
        });
      });

      const excludeClientId = connectionId
        ? `${req.inventoryId}:${user.sub}:${connectionId}`
        : undefined;

      for (const movement of normalizedMovements) {
        const item = itemsById.get(movement.itemId);
        const targetSpace = spacesById.get(movement.targetSpaceId);
        broadcast({
          inventoryId: req.inventoryId,
          spaceId: movement.targetSpaceId,
          action: "item_relocated",
          excludeClientId,
          payload: {
            itemId: item.id,
            patrimonio: item.patrimonio,
            descricao: item.descricao,
            fromSpaceId: item.spaceId,
            fromSpaceName: item.space?.name,
            toSpaceId: movement.targetSpaceId,
            toSpaceName: targetSpace?.name,
            user: user.fullName || user.sub,
            timestamp: movedAt,
          },
        });
        broadcast({
          inventoryId: req.inventoryId,
          spaceId: item.spaceId,
          action: "item_left_space",
          excludeClientId,
          payload: {
            itemId: item.id,
            patrimonio: item.patrimonio,
            descricao: item.descricao,
            fromSpaceId: item.spaceId,
            fromSpaceName: item.space?.name,
            toSpaceId: movement.targetSpaceId,
            toSpaceName: targetSpace?.name,
            user: user.fullName || user.sub,
            timestamp: movedAt,
          },
        });
      }

      for (const spaceId of affectedSpaceIds) {
        await recomputeSpaceCounters(spaceId, req.inventoryId).catch((err) => {
          console.warn(
            "Failed to recompute counters after planned relocation:",
            err.message || err,
          );
        });
      }

      res.json({
        success: true,
        updatedCount: items.length,
        affectedSpaceCount: affectedSpaceIds.length,
        finalizedSpaceTouched: hasFinalizedSpace,
        message: "Movimentações planejadas executadas com sucesso",
      });
    } catch (err) {
      console.error("Error executing planned relocations:", err);
      res
        .status(500)
        .json({ error: "Erro ao executar movimentações planejadas" });
    }
  },
);

router.post(
  "/relocate-group",
  verifyJWT,
  requireInventoryAccess(),
  requireInventoryWriteAccess(),
  requireInventoryOperationalWrite(),
  async (req, res) => {
    try {
      const { itemGroupId, sourceSpaceId, targetSpaceId, count, connectionId } =
        req.body;
      const user = req.user;

      if (!itemGroupId || !sourceSpaceId || !targetSpaceId || !count) {
        return res.status(400).json({
          error:
            "itemGroupId, sourceSpaceId, targetSpaceId e count são obrigatórios",
        });
      }

      const qty = Number(count);
      if (!Number.isInteger(qty) || qty < 1) {
        return res
          .status(400)
          .json({ error: "count deve ser um inteiro positivo" });
      }

      const [targetSpace, items] = await Promise.all([
        prisma.space.findFirst({
          where: { id: targetSpaceId, inventoryId: req.inventoryId, isActive: true },
          select: { id: true, name: true, isFinalized: true },
        }),
        prisma.item.findMany({
          where: {
            inventoryId: req.inventoryId,
            itemGroupId,
            spaceId: sourceSpaceId,
          },
          select: { id: true, statusEncontrado: true },
          take: qty,
        }),
      ]);

      if (!targetSpace) {
        return res.status(400).json({ error: "Espaço de destino inválido" });
      }

      if (targetSpace.isFinalized) {
        return res
          .status(409)
          .json({
            error: "A sala de destino está finalizada e não pode receber itens",
          });
      }

      const sourceSpace = await prisma.space.findUnique({
        where: { id: sourceSpaceId },
        select: { id: true, name: true, isFinalized: true },
      });
      if (sourceSpace?.isFinalized) {
        const allUnfound = items.every((i) => i.statusEncontrado === "NAO");
        if (!allUnfound) {
          return res
            .status(409)
            .json({
              error: "Esta sala está finalizada e não pode ter itens removidos",
            });
        }
      }

      if (items.length === 0) {
        return res.status(404).json({
          error: "Nenhum item do grupo encontrado no espaço de origem",
        });
      }

      const movedAt = new Date();
      const itemIds = items.map((i) => i.id);
      const unfoundSet = new Set(
        items.filter((i) => i.statusEncontrado === "NAO").map((i) => i.id),
      );

      const relocationData = itemIds.map((itemId) => ({
        itemId,
        fromSpaceId: sourceSpaceId,
        toSpaceId: targetSpaceId,
        movedBy: user.sub,
        movedAt,
        pendingConfirm: true,
        wasUnfound: unfoundSet.has(itemId),
      }));

      await prisma.$transaction([
        prisma.item.updateMany({
          where: { id: { in: itemIds }, inventoryId: req.inventoryId },
          data: {
            spaceId: targetSpaceId,
            lastKnownSpaceId: sourceSpaceId,
            statusEncontrado: "PENDENTE",
          },
        }),
        prisma.relocation.deleteMany({
          where: { itemId: { in: itemIds } },
        }),
        prisma.relocation.createMany({
          data: relocationData,
        }),
        prisma.itemHistorico.createMany({
          data: itemIds.map((itemId) => ({
            itemId,
            fromSpaceId: sourceSpaceId,
            toSpaceId: targetSpaceId,
            action: "REALOCADO",
            createdBy: user.sub,
            metadata: JSON.stringify({ groupBatch: true, groupMoveCount: qty }),
            createdAt: movedAt,
          })),
        }),
      ]);

      // Build excludeClientId from inventoryId + userId + connectionId to exclude only this session
      const excludeClientId = connectionId
        ? `${req.inventoryId}:${user.sub}:${connectionId}`
        : undefined;

      // Notify users in the DESTINATION space
      broadcast({
        inventoryId: req.inventoryId,
        spaceId: targetSpaceId,
        action: "group_relocated",
        excludeClientId,
        payload: {
          itemIds,
          fromSpaceId: sourceSpaceId,
          fromSpaceName: sourceSpace?.name,
          toSpaceId: targetSpaceId,
          toSpaceName: targetSpace.name,
          user: user.fullName || user.sub,
          count: items.length,
          timestamp: movedAt,
        },
      });

      // Notify users in the SOURCE space that items left
      broadcast({
        inventoryId: req.inventoryId,
        spaceId: sourceSpaceId,
        action: "group_left_space",
        excludeClientId,
        payload: {
          fromSpaceId: sourceSpaceId,
          fromSpaceName: sourceSpace?.name,
          toSpaceId: targetSpaceId,
          toSpaceName: targetSpace.name,
          user: user.fullName || user.sub,
          count: items.length,
          timestamp: movedAt,
        },
      });

      // Recompute counters for both spaces affected by the group move
      try {
        await recomputeSpaceCounters(targetSpaceId, req.inventoryId);
        await recomputeSpaceCounters(sourceSpaceId, req.inventoryId);
      } catch (err) {
        console.warn(
          "Failed to recompute counters after group relocate:",
          err.message || err,
        );
      }

      res.json({
        success: true,
        movedCount: items.length,
        message: `${items.length} item(ns) do grupo realocados com sucesso`,
      });
    } catch (err) {
      console.error("Error relocating group items:", err);
      res.status(500).json({ error: "Erro ao realocar itens do grupo" });
    }
  },
);


router.post(
  "/unfound",
  verifyJWT,
  requireInventoryAccess(),
  requireInventoryWriteAccess(),
  requireInventoryOperationalWrite(),
  async (req, res) => {
    try {
      const { itemId } = req.body;
      const user = req.user;

      const item = await prisma.item.findUnique({
        where: { id: itemId },
        select: { spaceId: true, inventoryId: true },
      });

      if (!item || item.inventoryId !== req.inventoryId) {
        return res.status(404).json({ error: "Item não encontrado" });
      }

      await prisma.item.updateMany({
        where: { id: itemId, inventoryId: req.inventoryId },
        data: {
          statusEncontrado: "NAO",
          lastKnownSpaceId: item.spaceId,
          dataConferencia: new Date(),
          ultimoConferente: user.sub,
        },
      });

      await recordItemHistory(prisma, {
        itemId,
        fromSpaceId: item.spaceId,
        action: "NAO_LOCALIZADO",
        createdBy: user.sub,
      });

      await markSpaceStarted(prisma, {
        inventoryId: req.inventoryId,
        spaceId: item.spaceId,
        user,
      });

      // Optionally exclude the triggering client session from receiving this broadcast
      const connectionId = req.body?.connectionId;
      const excludeClientId = connectionId
        ? `${req.inventoryId}:${user.sub}:${connectionId}`
        : undefined;

      // Notify other users watching this space that an item was marked as not found
      broadcast({
        inventoryId: req.inventoryId,
        spaceId: item.spaceId,
        action: "item_unfound",
        excludeClientId,
        payload: {
          itemId,
          spaceId: item.spaceId,
          action: "NAO_LOCALIZADO",
          user: user.fullName || user.sub,
          timestamp: new Date(),
        },
      });

      try {
        await recomputeSpaceCounters(item.spaceId, req.inventoryId);
      } catch (err) {
        console.warn(
          "Failed to recompute counters after unfound:",
          err.message || err,
        );
      }

      res.json({ success: true });
    } catch (err) {
      console.error("Error marking item unfound:", err);
      res.status(500).json({ error: "Erro ao marcar item" });
    }
  },
);

router.post(
  "/uncheck",
  verifyJWT,
  requireInventoryAccess(),
  requireInventoryWriteAccess(),
  requireInventoryOperationalWrite(),
  async (req, res) => {
    try {
      const { itemId } = req.body;
      const user = req.user;

      const item = await prisma.item.findUnique({
        where: { id: itemId },
        select: {
          id: true,
          spaceId: true,
          inventoryId: true,
          statusEncontrado: true,
        },
      });

      if (!item || item.inventoryId !== req.inventoryId) {
        return res.status(404).json({ error: "Item não encontrado" });
      }

      if (item.statusEncontrado !== "SIM") {
        return res.status(400).json({
          error: "Somente itens marcados como encontrados podem ser desfeitos",
        });
      }

      await prisma.item.updateMany({
        where: { id: itemId, inventoryId: req.inventoryId },
        data: {
          statusEncontrado: "PENDENTE",
          condicaoVisual: null,
          dataConferencia: null,
          ultimoConferente: null,
        },
      });

      await recordItemHistory(prisma, {
        itemId,
        fromSpaceId: item.spaceId,
        toSpaceId: item.spaceId,
        action: "DESFEITO_ENCONTRADO",
        createdBy: user.sub,
      });

      // Broadcast the uncheck action so dashboards / clients update in real time
      const connectionId = req.body?.connectionId;
      const excludeClientId = connectionId
        ? `${req.inventoryId}:${user.sub}:${connectionId}`
        : undefined;

      broadcast({
        inventoryId: req.inventoryId,
        spaceId: item.spaceId,
        action: "item_unchecked",
        excludeClientId,
        payload: {
          itemId,
          spaceId: item.spaceId,
          action: "DESFEITO_ENCONTRADO",
          user: user.fullName || user.sub,
          timestamp: new Date(),
        },
      });

      try {
        await recomputeSpaceCounters(item.spaceId, req.inventoryId);
      } catch (err) {
        console.warn(
          "Failed to recompute counters after uncheck:",
          err.message || err,
        );
      }

      res.json({ success: true });
    } catch (err) {
      console.error("Error undoing item check:", err);
      res.status(500).json({ error: "Erro ao desfazer item encontrado" });
    }
  },
);

router.post(
  "/:itemId/restore",
  verifyJWT,
  requireInventoryAccess(),
  requireInventoryWriteAccess(),
  requireInventoryOperationalWrite(),
  async (req, res) => {
    try {
      const { itemId } = req.params;
      const { connectionId } = req.body;
      const user = req.user;

      const item = await prisma.item.findUnique({
        where: { id: itemId },
        select: {
          spaceId: true,
          lastKnownSpaceId: true,
          inventoryId: true,
        },
      });

      if (!item || item.inventoryId !== req.inventoryId) {
        return res.status(404).json({ error: "Item não encontrado" });
      }

      await prisma.item.updateMany({
        where: { id: itemId, inventoryId: req.inventoryId },
        data: {
          statusEncontrado: "SIM",
          spaceId: item.lastKnownSpaceId || undefined,
          dataConferencia: new Date(),
          ultimoConferente: user.sub,
        },
      });

      await recordItemHistory(prisma, {
        itemId,
        fromSpaceId: item.spaceId,
        toSpaceId: item.lastKnownSpaceId || item.spaceId,
        action: "ESTORNADO",
        createdBy: user.sub,
      });

      // Build excludeClientId from inventoryId + userId + connectionId to exclude only this session
      const excludeClientId = connectionId
        ? `${req.inventoryId}:${user.sub}:${connectionId}`
        : undefined;

      // Notify users in the restored space
      broadcast({
        inventoryId: req.inventoryId,
        spaceId: item.lastKnownSpaceId || item.spaceId,
        action: "item_restored",
        excludeClientId,
        payload: {
          itemId,
          spaceId: item.lastKnownSpaceId || item.spaceId,
          action: "ESTORNADO",
          user: user.fullName || user.sub,
          timestamp: new Date(),
        },
      });

      try {
        await recomputeSpaceCounters(
          item.lastKnownSpaceId || item.spaceId,
          req.inventoryId,
        );
      } catch (err) {
        console.warn(
          "Failed to recompute counters after restore:",
          err.message || err,
        );
      }

      res.json({ success: true });
    } catch (err) {
      console.error("Error restoring item:", err);
      res.status(500).json({ error: "Erro ao marcar item como encontrado" });
    }
  },
);

router.post(
  "/check-batch",
  verifyJWT,
  requireInventoryAccess(),
  requireInventoryWriteAccess(),
  requireInventoryOperationalWrite(),
  async (req, res) => {
    try {
      const {
        spaceId,
        patrimonioInicial,
        patrimonioFinal,
        condicaoVisual,
        dryRun,
        connectionId,
      } = req.body;
      const user = req.user;

      if (
        !spaceId ||
        patrimonioInicial === undefined ||
        patrimonioFinal === undefined
      ) {
        return res.status(400).json({
          error:
            "spaceId, patrimonioInicial e patrimonioFinal são obrigatórios",
        });
      }

      const startNumber = normalizePatrimonioNumber(patrimonioInicial);
      const endNumber = normalizePatrimonioNumber(patrimonioFinal);

      if (startNumber === null || endNumber === null) {
        return res.status(400).json({
          error: "Intervalo inválido: use números de patrimônio válidos",
        });
      }

      const [rangeStart, rangeEnd] =
        startNumber <= endNumber
          ? [startNumber, endNumber]
          : [endNumber, startNumber];

      const space = await prisma.space.findFirst({
        where: {
          id: spaceId,
          inventoryId: req.inventoryId,
        },
        select: { id: true },
      });

      if (!space) {
        return res.status(404).json({ error: "Espaço não encontrado" });
      }

      const spaceItems = await prisma.item.findMany({
        where: {
          inventoryId: req.inventoryId,
          spaceId,
        },
        select: {
          id: true,
          patrimonio: true,
        },
      });

      const matchedItems = [];
      const skippedPatrimonios = [];

      for (const item of spaceItems) {
        const numericValue = normalizePatrimonioNumber(item.patrimonio);
        if (numericValue === null) {
          skippedPatrimonios.push(item.patrimonio);
          continue;
        }

        if (numericValue >= rangeStart && numericValue <= rangeEnd) {
          matchedItems.push(item);
        } else {
          skippedPatrimonios.push(item.patrimonio);
        }
      }

      if (dryRun) {
        return res.json({
          success: true,
          dryRun: true,
          updatedCount: 0,
          matchedCount: matchedItems.length,
          skippedCount: skippedPatrimonios.length,
          skippedPatrimonios,
        });
      }

      if (matchedItems.length === 0) {
        return res.json({
          success: true,
          updatedCount: 0,
          skippedCount: skippedPatrimonios.length,
          skippedPatrimonios,
        });
      }

      await markSpaceStarted(prisma, {
        inventoryId: req.inventoryId,
        spaceId,
        user,
      });

      const timestamp = new Date();
      const itemIds = matchedItems.map((item) => item.id);
      const updateData = {
        statusEncontrado: "SIM",
        dataConferencia: timestamp,
        ultimoConferente: user.sub,
      };

      if (condicaoVisual) {
        updateData.condicaoVisual = condicaoVisual;
      }

      await prisma.$transaction([
        prisma.item.updateMany({
          where: {
            id: { in: itemIds },
            inventoryId: req.inventoryId,
          },
          data: updateData,
        }),
        prisma.relocation.updateMany({
          where: {
            itemId: { in: itemIds },
            pendingConfirm: true,
          },
          data: { pendingConfirm: false },
        }),
        prisma.itemHistorico.createMany({
          data: itemIds.map((itemId) => ({
            itemId,
            fromSpaceId: spaceId,
            action: "ENCONTRADO",
            createdBy: user.sub,
            metadata: JSON.stringify({
              batch: true,
              condicaoVisual: condicaoVisual || null,
              patrimonioInicial,
              patrimonioFinal,
            }),
            createdAt: timestamp,
          })),
        }),
      ]);

      // Build excludeClientId from inventoryId + userId + connectionId to exclude only this session
      const excludeClientId = connectionId
        ? `${req.inventoryId}:${user.sub}:${connectionId}`
        : undefined;

      // Notify other users watching this space
      broadcast({
        inventoryId: req.inventoryId,
        spaceId,
        action: "batch_checked",
        excludeClientId,
        payload: {
          spaceId,
          action: "ENCONTRADO",
          user: user.fullName || user.sub,
          count: matchedItems.length,
          timestamp: new Date(),
        },
      });

      try {
        await recomputeSpaceCounters(spaceId, req.inventoryId);
      } catch (err) {
        console.warn(
          "Failed to recompute counters after batch check:",
          err.message || err,
        );
      }

      res.json({
        success: true,
        updatedCount: matchedItems.length,
        skippedCount: skippedPatrimonios.length,
        skippedPatrimonios,
      });
    } catch (err) {
      console.error("Error checking items in batch:", err);
      res.status(500).json({ error: "Erro ao marcar itens em massa" });
    }
  },
);

router.post(
  "/unfound-batch",
  verifyJWT,
  requireInventoryAccess(),
  requireInventoryWriteAccess(),
  requireInventoryOperationalWrite(),
  async (req, res) => {
    try {
      const {
        spaceId,
        patrimonioInicial,
        patrimonioFinal,
        dryRun,
        connectionId,
      } = req.body;
      const user = req.user;

      if (
        !spaceId ||
        patrimonioInicial === undefined ||
        patrimonioFinal === undefined
      ) {
        return res.status(400).json({
          error:
            "spaceId, patrimonioInicial e patrimonioFinal são obrigatórios",
        });
      }

      const startNumber = normalizePatrimonioNumber(patrimonioInicial);
      const endNumber = normalizePatrimonioNumber(patrimonioFinal);

      if (startNumber === null || endNumber === null) {
        return res.status(400).json({
          error: "Intervalo inválido: use números de patrimônio válidos",
        });
      }

      const [rangeStart, rangeEnd] =
        startNumber <= endNumber
          ? [startNumber, endNumber]
          : [endNumber, startNumber];

      const space = await prisma.space.findFirst({
        where: { id: spaceId, inventoryId: req.inventoryId },
        select: { id: true },
      });

      if (!space) {
        return res.status(404).json({ error: "Espaço não encontrado" });
      }

      const spaceItems = await prisma.item.findMany({
        where: { inventoryId: req.inventoryId, spaceId },
        select: { id: true, patrimonio: true },
      });

      const matchedItems = [];
      const skippedPatrimonios = [];

      for (const item of spaceItems) {
        const numericValue = normalizePatrimonioNumber(item.patrimonio);
        if (numericValue === null) {
          skippedPatrimonios.push(item.patrimonio);
          continue;
        }
        if (numericValue >= rangeStart && numericValue <= rangeEnd) {
          matchedItems.push(item);
        } else {
          skippedPatrimonios.push(item.patrimonio);
        }
      }

      if (dryRun) {
        return res.json({
          success: true,
          dryRun: true,
          updatedCount: 0,
          matchedCount: matchedItems.length,
          skippedCount: skippedPatrimonios.length,
          skippedPatrimonios,
        });
      }

      if (matchedItems.length === 0) {
        return res.json({
          success: true,
          updatedCount: 0,
          skippedCount: skippedPatrimonios.length,
          skippedPatrimonios,
        });
      }

      await markSpaceStarted(prisma, {
        inventoryId: req.inventoryId,
        spaceId,
        user,
      });

      const timestamp = new Date();
      const itemIds = matchedItems.map((item) => item.id);

      await prisma.$transaction([
        prisma.item.updateMany({
          where: { id: { in: itemIds }, inventoryId: req.inventoryId },
          data: {
            statusEncontrado: "NAO",
            lastKnownSpaceId: spaceId,
            dataConferencia: timestamp,
            ultimoConferente: user.sub,
          },
        }),
        prisma.itemHistorico.createMany({
          data: itemIds.map((itemId) => ({
            itemId,
            fromSpaceId: spaceId,
            action: "NAO_LOCALIZADO",
            createdBy: user.sub,
            metadata: JSON.stringify({
              batch: true,
              patrimonioInicial,
              patrimonioFinal,
            }),
            createdAt: timestamp,
          })),
        }),
      ]);

      const excludeClientId = connectionId
        ? `${req.inventoryId}:${user.sub}:${connectionId}`
        : undefined;

      broadcast({
        inventoryId: req.inventoryId,
        spaceId,
        action: "batch_unfound",
        excludeClientId,
        payload: {
          spaceId,
          action: "NAO_LOCALIZADO",
          user: user.fullName || user.sub,
          count: matchedItems.length,
          timestamp: new Date(),
        },
      });

      try {
        await recomputeSpaceCounters(spaceId, req.inventoryId);
      } catch (err) {
        console.warn(
          "Failed to recompute counters after batch unfound:",
          err.message || err,
        );
      }

      res.json({
        success: true,
        updatedCount: matchedItems.length,
        skippedCount: skippedPatrimonios.length,
        skippedPatrimonios,
      });
    } catch (err) {
      console.error("Error marking items unfound in batch:", err);
      res
        .status(500)
        .json({ error: "Erro ao marcar itens como não localizados em massa" });
    }
  },
);

router.post(
  "/relocate-batch",
  verifyJWT,
  requireInventoryAccess(),
  requireInventoryWriteAccess(),
  requireInventoryOperationalWrite(),
  async (req, res) => {
    try {
      const {
        spaceId,
        targetSpaceId,
        patrimonioInicial,
        patrimonioFinal,
        dryRun,
        connectionId,
      } = req.body;
      const user = req.user;

      if (
        !spaceId ||
        !targetSpaceId ||
        patrimonioInicial === undefined ||
        patrimonioFinal === undefined
      ) {
        return res.status(400).json({
          error:
            "spaceId, targetSpaceId, patrimonioInicial e patrimonioFinal são obrigatórios",
        });
      }

      if (spaceId === targetSpaceId) {
        return res.status(400).json({
          error: "O espaço de destino deve ser diferente do espaço de origem",
        });
      }

      const startNumber = normalizePatrimonioNumber(patrimonioInicial);
      const endNumber = normalizePatrimonioNumber(patrimonioFinal);

      if (startNumber === null || endNumber === null) {
        return res.status(400).json({
          error: "Intervalo inválido: use números de patrimônio válidos",
        });
      }

      const [rangeStart, rangeEnd] =
        startNumber <= endNumber
          ? [startNumber, endNumber]
          : [endNumber, startNumber];

      const [space, targetSpace] = await Promise.all([
        prisma.space.findFirst({
          where: { id: spaceId, inventoryId: req.inventoryId },
          select: { id: true, name: true, isFinalized: true },
        }),
        prisma.space.findFirst({
          where: { id: targetSpaceId, inventoryId: req.inventoryId, isActive: true },
          select: { id: true, name: true, isFinalized: true },
        }),
      ]);

      if (!space) {
        return res.status(404).json({ error: "Espaço não encontrado" });
      }
      if (!targetSpace) {
        return res.status(400).json({ error: "Espaço de destino inválido" });
      }
      if (targetSpace.isFinalized) {
        return res.status(409).json({ error: "A sala de destino está finalizada e não pode receber itens" });
      }

      const spaceItems = await prisma.item.findMany({
        where: { inventoryId: req.inventoryId, spaceId },
        select: { id: true, patrimonio: true, statusEncontrado: true },
      });

      const matchedItems = [];
      const skippedPatrimonios = [];

      for (const item of spaceItems) {
        const numericValue = normalizePatrimonioNumber(item.patrimonio);
        if (numericValue === null) {
          skippedPatrimonios.push(item.patrimonio);
          continue;
        }
        if (numericValue >= rangeStart && numericValue <= rangeEnd) {
          matchedItems.push(item);
        } else {
          skippedPatrimonios.push(item.patrimonio);
        }
      }

      if (dryRun) {
        return res.json({
          success: true,
          dryRun: true,
          updatedCount: 0,
          matchedCount: matchedItems.length,
          skippedCount: skippedPatrimonios.length,
          skippedPatrimonios,
        });
      }

      if (matchedItems.length === 0) {
        return res.json({
          success: true,
          updatedCount: 0,
          skippedCount: skippedPatrimonios.length,
          skippedPatrimonios,
        });
      }

      const movedAt = new Date();
      const itemIds = matchedItems.map((item) => item.id);

      const relocationData = matchedItems.map((item) => ({
        itemId: item.id,
        fromSpaceId: spaceId,
        toSpaceId: targetSpaceId,
        movedBy: user.sub,
        movedAt,
        pendingConfirm: true,
        wasUnfound: item.statusEncontrado === "NAO",
      }));

      await prisma.$transaction([
        prisma.item.updateMany({
          where: { id: { in: itemIds }, inventoryId: req.inventoryId },
          data: {
            spaceId: targetSpaceId,
            lastKnownSpaceId: spaceId,
            statusEncontrado: "PENDENTE",
          },
        }),
        prisma.relocation.deleteMany({ where: { itemId: { in: itemIds } } }),
        prisma.relocation.createMany({ data: relocationData }),
        prisma.itemHistorico.createMany({
          data: itemIds.map((itemId) => ({
            itemId,
            fromSpaceId: spaceId,
            toSpaceId: targetSpaceId,
            action: "REALOCADO",
            createdBy: user.sub,
            metadata: JSON.stringify({
              batch: true,
              patrimonioInicial,
              patrimonioFinal,
            }),
            createdAt: movedAt,
          })),
        }),
      ]);

      const excludeClientId = connectionId
        ? `${req.inventoryId}:${user.sub}:${connectionId}`
        : undefined;

      broadcast({
        inventoryId: req.inventoryId,
        spaceId: targetSpaceId,
        action: "batch_relocated",
        excludeClientId,
        payload: {
          fromSpaceId: spaceId,
          fromSpaceName: space.name,
          toSpaceId: targetSpaceId,
          toSpaceName: targetSpace.name,
          user: user.fullName || user.sub,
          count: matchedItems.length,
          timestamp: movedAt,
        },
      });

      // Notify users in the SOURCE space that items left
      broadcast({
        inventoryId: req.inventoryId,
        spaceId: spaceId,
        action: "batch_left_space",
        excludeClientId,
        payload: {
          fromSpaceId: spaceId,
          fromSpaceName: space.name,
          toSpaceId: targetSpaceId,
          toSpaceName: targetSpace.name,
          user: user.fullName || user.sub,
          count: matchedItems.length,
          timestamp: movedAt,
        },
      });

      try {
        await recomputeSpaceCounters(targetSpaceId, req.inventoryId);
        await recomputeSpaceCounters(spaceId, req.inventoryId);
      } catch (err) {
        console.warn(
          "Failed to recompute counters after batch relocate:",
          err.message || err,
        );
      }

      res.json({
        success: true,
        updatedCount: matchedItems.length,
        skippedCount: skippedPatrimonios.length,
        skippedPatrimonios,
      });
    } catch (err) {
      console.error("Error relocating items in batch:", err);
      res.status(500).json({ error: "Erro ao mover itens em massa" });
    }
  },
);

// ========================================
// REVISOR VERIFICATION ENDPOINT
// ========================================

/**
 * POST /api/items/:id/verify-check
 * Revisor re-checks items during finalized space verification
 * Only works on items with verificationStatus = "REVERIFICAR"
 */
router.post(
  "/:id/verify-check",
  verifyJWT,
  requireInventoryAccess(),
  requireVerificationAccess(),
  async (req, res) => {
    try {
      const { id } = req.params;
      const { condicao, spaceId } = req.body;
      const user = req.user;

      if (!spaceId || !["SIM", "NAO"].includes(condicao)) {
        return res.status(400).json({
          error: "spaceId e condicao (SIM/NAO) são obrigatórios",
        });
      }

      // Get item
      const item = await prisma.item.findUnique({
        where: { id },
        include: { space: true },
      });

      if (!item) {
        return res.status(404).json({ error: "Item não encontrado" });
      }

      if (item.inventoryId !== req.inventoryId) {
        return res.status(403).json({ error: "Acesso negado" });
      }

      if (item.spaceId !== spaceId) {
        return res.status(400).json({ error: "Item não está neste espaço" });
      }

      if (item.verificationStatus !== "REVERIFICAR") {
        return res.status(400).json({
          error: "Item já foi verificado ou não está marcado para reverificação",
        });
      }

      const timestamp = new Date();

      // Helper: check if all items in the roll are resolved (no REVERIFICAR left)
      async function checkAllResolved() {
        const roll = await prisma.verificationRoll.findFirst({
          where: { spaceId, result: "PENDING" },
        });
        if (!roll) return false;
        const selectedIds = JSON.parse(roll.itemIds);
        const unresolvedCount = await prisma.item.count({
          where: { id: { in: selectedIds }, verificationStatus: "REVERIFICAR" },
        });
        return unresolvedCount === 0;
      }

      // If "NAO" (not found during verification) — item stays in room, marked red
      if (condicao === "NAO") {
        await prisma.item.update({
          where: { id },
          data: {
            verificationStatus: "NAO_LOCALIZADO_VERIFICACAO",
            verifiedAt: timestamp,
            verifiedBy: user.sub,
          },
        });

        await recordItemHistory(prisma, {
          itemId: id,
          fromSpaceId: spaceId,
          toSpaceId: spaceId,
          action: "NAO_LOCALIZADO_VERIFICACAO",
          createdBy: user.sub,
          metadata: JSON.stringify({ patrimonio: item.patrimonio }),
        });

        // Auto-revert the space back to open — item failed verification
        await prisma.space.update({
          where: { id: spaceId },
          data: { isFinalized: false, isVerifiedByRevisor: false },
        });

        // Clear REVERIFICAR from all remaining items in the space
        await prisma.item.updateMany({
          where: { spaceId, verificationStatus: "REVERIFICAR" },
          data: { verificationStatus: null, verifiedAt: null, verifiedBy: null },
        });

        // Also clear the NAO_LOCALIZADO_VERIFICACAO mark so item is visible again for conferente
        await prisma.item.update({
          where: { id },
          data: { verificationStatus: null },
        });

        // Close the verification roll as REVERTED
        const activeRoll = await prisma.verificationRoll.findFirst({
          where: { spaceId, result: "PENDING" },
        });
        if (activeRoll) {
          await prisma.verificationRoll.update({
            where: { id: activeRoll.id },
            data: {
              result: "REVERTED",
              reason: `Item #${item.patrimonio} não localizado na reverificação`,
              reviewedAt: timestamp,
            },
          });
        }

        // Record in finalization history
        await prisma.finalizationHistory.create({
          data: {
            spaceId,
            action: "REVERTED_ITEM_NOT_FOUND",
            reason: `Item #${item.patrimonio} não localizado durante reverificação pelo revisor`,
            actedBy: user.sub,
          },
        });

        broadcast({
          inventoryId: req.inventoryId,
          spaceId,
          action: "space_auto_reverted",
          payload: {
            spaceId,
            patrimonio: item.patrimonio,
            user: user.fullName || user.sub,
            reason: "item_not_found_verification",
          },
        });

        return res.json({
          success: true,
          autoReverted: true,
          message: `Item #${item.patrimonio} não localizado — sala reaberta para conferência`,
          item: { id, verificationStatus: null, verifiedAt: timestamp, verifiedBy: user.sub },
        });
      }

      // If "SIM" (found), mark as verified
      await prisma.item.update({
        where: { id },
        data: {
          statusEncontrado: "SIM",
          condicaoVisual: condicao,
          dataConferencia: timestamp,
          ultimoConferente: user.sub,
          verificationStatus: null, // Clear verification mark
          verifiedAt: timestamp,
          verifiedBy: user.sub,
        },
      });

      // Clear pending relocation confirmation
      await prisma.relocation.updateMany({
        where: { itemId: id, pendingConfirm: true },
        data: { pendingConfirm: false },
      });

      // Record history
      await recordItemHistory(prisma, {
        itemId: id,
        fromSpaceId: spaceId,
        toSpaceId: spaceId,
        action: "VERIFICADO",
        createdBy: user.sub,
        metadata: null,
      });

      const allResolved = await checkAllResolved();

      // Notify other users
      broadcast({
        inventoryId: req.inventoryId,
        spaceId,
        action: "item_verified",
        payload: {
          itemId: id,
          patrimonio: item.patrimonio,
          spaceId,
          user: user.fullName || user.sub,
          allResolved,
        },
      });

      try {
        await recomputeSpaceCounters(spaceId, req.inventoryId);
      } catch (err) {
        console.warn(
          "Failed to recompute counters after verify-check:",
          err.message || err,
        );
      }

      res.json({
        success: true,
        message: "Item verificado com sucesso",
        allResolved,
        item: {
          id,
          statusEncontrado: "SIM",
          verificationStatus: null,
          verifiedAt: timestamp,
          verifiedBy: user.sub,
        },
      });
    } catch (err) {
      console.error("Error verifying item:", err);
      res.status(500).json({ error: "Erro ao verificar item" });
    }
  },
);

// ─── POST /items/action-by-ids — ações em lote por array de IDs (multi-select) ─
// Substitui o forEach de enqueueAction no frontend, evitando race condition no queue.
router.post(
  "/action-by-ids",
  verifyJWT,
  requireInventoryAccess(),
  requireInventoryWriteAccess(),
  requireInventoryOperationalWrite(),
  async (req, res) => {
    try {
      const { itemIds, action, condicaoVisual, targetSpaceId, connectionId } = req.body;
      const user = req.user;

      if (!Array.isArray(itemIds) || itemIds.length === 0) {
        return res.status(400).json({ error: "itemIds é obrigatório e deve ser um array não-vazio" });
      }
      if (!["check", "unfound", "relocate"].includes(action)) {
        return res.status(400).json({ error: "action deve ser 'check', 'unfound' ou 'relocate'" });
      }
      if (action === "relocate" && !targetSpaceId) {
        return res.status(400).json({ error: "targetSpaceId é obrigatório para action 'relocate'" });
      }

      // Carrega apenas itens do inventário correto
      const items = await prisma.item.findMany({
        where: { id: { in: itemIds }, inventoryId: req.inventoryId },
        select: { id: true, spaceId: true },
      });

      if (items.length === 0) {
        return res.json({ success: true, updatedCount: 0 });
      }

      const timestamp = new Date();
      const spaceIds = [...new Set(items.map((i) => i.spaceId))];

      if (action === "check") {
        await prisma.$transaction([
          prisma.item.updateMany({
            where: { id: { in: items.map((i) => i.id) } },
            data: { statusEncontrado: "SIM", condicaoVisual: condicaoVisual || "BOM", dataConferencia: timestamp, ultimoConferente: user.sub },
          }),
          prisma.itemHistorico.createMany({
            data: items.map((item) => ({
              itemId: item.id, fromSpaceId: item.spaceId,
              action: "ENCONTRADO", createdBy: user.sub, createdAt: timestamp,
              metadata: JSON.stringify({ batch: true, source: "multi-select" }),
            })),
          }),
        ]);
      } else if (action === "unfound") {
        await prisma.$transaction([
          prisma.item.updateMany({
            where: { id: { in: items.map((i) => i.id) } },
            data: { statusEncontrado: "NAO", lastKnownSpaceId: items[0].spaceId, dataConferencia: timestamp, ultimoConferente: user.sub },
          }),
          prisma.itemHistorico.createMany({
            data: items.map((item) => ({
              itemId: item.id, fromSpaceId: item.spaceId,
              action: "NAO_LOCALIZADO", createdBy: user.sub, createdAt: timestamp,
              metadata: JSON.stringify({ batch: true, source: "multi-select" }),
            })),
          }),
        ]);
      } else if (action === "relocate") {
        const targetSpace = await prisma.space.findFirst({
          where: { id: targetSpaceId, inventoryId: req.inventoryId, isActive: true },
          select: { id: true, name: true, isFinalized: true },
        });
        if (!targetSpace || targetSpace.isFinalized) {
          return res.status(400).json({ error: "Sala de destino não encontrada ou finalizada" });
        }
        await prisma.$transaction([
          prisma.item.updateMany({
            where: { id: { in: items.map((i) => i.id) } },
            data: { spaceId: targetSpaceId, statusEncontrado: "NAO", dataConferencia: timestamp, ultimoConferente: user.sub },
          }),
          prisma.itemHistorico.createMany({
            data: items.map((item) => ({
              itemId: item.id, fromSpaceId: item.spaceId, toSpaceId: targetSpaceId,
              action: "REALOCADO", createdBy: user.sub, createdAt: timestamp,
              metadata: JSON.stringify({ batch: true, source: "multi-select" }),
            })),
          }),
        ]);
        // Recompute counters for source spaces too
        for (const sid of spaceIds) {
          await recomputeSpaceCounters(sid, req.inventoryId).catch(() => {});
        }
      }

      // Mark each affected space as started and recompute counters
      for (const sid of spaceIds) {
        await markSpaceStarted(prisma, { inventoryId: req.inventoryId, spaceId: sid, user }).catch(() => {});
        await recomputeSpaceCounters(sid, req.inventoryId).catch(() => {});
      }

      // SSE broadcast
      const excludeClientId = connectionId ? `${req.inventoryId}:${user.sub}:${connectionId}` : undefined;
      const sseAction = action === "check" ? "batch_checked" : action === "unfound" ? "batch_unfound" : "batch_relocated";
      for (const sid of spaceIds) {
        broadcast({
          inventoryId: req.inventoryId, spaceId: sid, action: sseAction, excludeClientId,
          payload: { count: items.length, user: user.fullName || user.sub, timestamp },
        });
      }

      res.json({ success: true, updatedCount: items.length });
    } catch (err) {
      console.error("Error in action-by-ids:", err);
      res.status(500).json({ error: "Erro ao processar ação em lote" });
    }
  },
);

// ─── POST /items/import-books — importa livros via upload de XLSX ───────────────
// Campos do form: xlsxFile (file), spaceId (string), inventoryId (string)
// Lógica:
//   - Se tem patrimônio e item já existe no inventário → mescla (atualiza campos de acervo)
//   - Se tem patrimônio mas não existe → cria item novo
//   - Se não tem patrimônio mas tem codigoBarras → upsert por codigoBarras
//   - Nenhum identificador → pula
router.post(
  "/import-books",
  verifyJWT,
  requireInventoryAccess(),
  requireInventoryWriteAccess(),
  upload.single("xlsxFile"),
  async (req, res) => {
    try {
      const { spaceId } = req.body;
      const inventoryId = req.inventoryId;

      if (!req.file) return res.status(400).json({ error: "Arquivo XLSX não enviado" });
      if (!spaceId)   return res.status(400).json({ error: "spaceId é obrigatório" });

      const space = await prisma.space.findFirst({
        where: { id: spaceId, inventoryId },
        select: { id: true, name: true },
      });
      if (!space) return res.status(400).json({ error: "Sala não encontrada no inventário" });

      // ── 1. Ler XLSX completamente em memória (síncrono após load) ─────────────
      const workbook = new ExcelJS.Workbook();
      await workbook.xlsx.load(req.file.buffer);

      const worksheet = workbook.worksheets[0];
      if (!worksheet) return res.status(400).json({ error: "Nenhuma aba encontrada no arquivo XLSX" });

      const bookColumns = detectBookColumns(worksheet);

      // ── 2. Extrair linhas com dados (sem tocar no banco ainda) ───────────────
      const rows = [];
      worksheet.eachRow((row, rowIdx) => {
        if (rowIdx === 1) return; // pular cabeçalho
        const codigoBarras   = bookCellText(row, bookColumns.codigoBarras);
        const patrimonio     = bookCellText(row, bookColumns.patrimonio);
        const titulo         = bookCellText(row, bookColumns.titulo);
        if (!codigoBarras && !patrimonio) return; // linha sem identificador
        rows.push({
          rowIdx,
          codigoBarras,
          patrimonio,
          titulo,
          codigoExemplar: bookCellText(row, bookColumns.codigoExemplar),
          numeroExemplar: bookCellText(row, bookColumns.numeroExemplar),
          autores:        bookCellText(row, bookColumns.autores),
          anoPublicacao:  bookCellText(row, bookColumns.anoPublicacao),
          catalogo:       bookCellText(row, bookColumns.catalogo),
          codigoRFID:     bookColumns.codigoRFID ? bookCellText(row, bookColumns.codigoRFID) : null,
        });
      });

      const skipped = (worksheet.rowCount - 1) - rows.length;
      console.log(
        `[IMPORT-BOOKS] ${rows.length} linhas com dados (${skipped} puladas)`,
        { bookColumns },
      );

      // ── 3. Buscar existentes em lote ─────────────────────────────────────────
      const patrimonios  = [...new Set(rows.filter(r => r.patrimonio).map(r => r.patrimonio))];
      const codBarras    = [...new Set(rows.filter(r => r.codigoBarras).map(r => r.codigoBarras))];

      const [existingByPat, existingByBarras] = await Promise.all([
        patrimonios.length
          ? prisma.item.findMany({
              where: { inventoryId, patrimonio: { in: patrimonios } },
              select: { id: true, patrimonio: true, descricao: true, codigoBarras: true },
            })
          : [],
        codBarras.length
          ? prisma.item.findMany({
              where: { inventoryId, codigoBarras: { in: codBarras } },
              select: { id: true, codigoBarras: true },
            })
          : [],
      ]);

      const patMap     = new Map(existingByPat.map(i => [i.patrimonio, i]));
      const barrasMap  = new Map(existingByBarras.map(i => [i.codigoBarras, i]));

      // ── 4. Separar em "criar" e "mesclar" ────────────────────────────────────
      const toCreate = [];
      const toMerge  = []; // { id, data }
      const errors   = [];
      const seenBarcodes = new Set();
      const claimedExistingIds = new Set();
      const duplicateRows = [];

      for (const r of rows) {
        if (r.codigoBarras) {
          if (seenBarcodes.has(r.codigoBarras)) {
            duplicateRows.push({
              rowIdx: r.rowIdx,
              codigoBarras: r.codigoBarras,
              error: "Código de barras/exemplar duplicado no arquivo",
            });
            continue;
          }
          seenBarcodes.add(r.codigoBarras);
        }

        const bookFields = {
          codigoBarras:   r.codigoBarras  || null,
          codigoRFID:     r.codigoRFID    || null,
          codigoExemplar: r.codigoExemplar || null,
          numeroExemplar: r.numeroExemplar || null,
          autores:        r.autores        || null,
          anoPublicacao:  r.anoPublicacao  || null,
          catalogo:       r.catalogo       || r.codigoExemplar || null,
        };

        if (r.codigoBarras) {
          const existingByBarcode = barrasMap.get(r.codigoBarras);
          if (existingByBarcode) {
            toMerge.push({
              id: existingByBarcode.id,
              data: {
                ...bookFields,
                patrimonio: r.patrimonio || null,
                descricao: r.titulo || undefined,
              },
            });
            claimedExistingIds.add(existingByBarcode.id);
            continue;
          }

          const existingByPatrimonio = r.patrimonio ? patMap.get(r.patrimonio) : null;
          if (
            existingByPatrimonio &&
            !existingByPatrimonio.codigoBarras &&
            !claimedExistingIds.has(existingByPatrimonio.id)
          ) {
            toMerge.push({
              id: existingByPatrimonio.id,
              data: {
                ...bookFields,
                patrimonio: r.patrimonio,
                descricao: existingByPatrimonio.descricao || r.titulo || undefined,
              },
            });
            claimedExistingIds.add(existingByPatrimonio.id);
          } else {
            toCreate.push({
              patrimonio: r.patrimonio || null,
              descricao: r.titulo || "Sem título",
              condicaoOriginal: "BOM",
              inventoryId,
              spaceId: space.id,
              statusEncontrado: "PENDENTE",
              ...bookFields,
            });
          }
        } else if (r.patrimonio) {
          const existing = patMap.get(r.patrimonio);
          if (existing) {
            toMerge.push({ id: existing.id, data: { ...bookFields, descricao: existing.descricao || r.titulo || existing.descricao } });
          } else {
            toCreate.push({ patrimonio: r.patrimonio, descricao: r.titulo || "Sem título", condicaoOriginal: "BOM", inventoryId, spaceId: space.id, statusEncontrado: "PENDENTE", ...bookFields });
          }
        }
      }

      console.log(
        `[IMPORT-BOOKS] criar=${toCreate.length} mesclar=${toMerge.length} duplicadasNoArquivo=${duplicateRows.length}`,
      );

      // ── 5. Criar novos itens em lote (chunks de 500) ─────────────────────────
      const CHUNK = 500;
      let created = 0, merged = 0;
      const createErrors = [];

      for (let i = 0; i < toCreate.length; i += CHUNK) {
        const chunk = toCreate.slice(i, i + CHUNK);
        try {
          const result = await prisma.item.createMany({ data: chunk, skipDuplicates: true });
          created += result.count;
        } catch (err) {
          createErrors.push(`Lote ${Math.floor(i / CHUNK) + 1}: ${err.message}`);
        }
      }

      // ── 6. Atualizar (mesclar) itens existentes em paralelo (chunks) ─────────
      for (let i = 0; i < toMerge.length; i += CHUNK) {
        const chunk = toMerge.slice(i, i + CHUNK);
        await Promise.allSettled(
          chunk.map(({ id, data }) =>
            prisma.item.update({ where: { id }, data }).then(() => { merged++; }).catch(err => {
              errors.push({ id, error: err.message });
            }),
          ),
        );
      }

      console.log(`[IMPORT-BOOKS] concluído: created=${created} merged=${merged} errors=${errors.length}`);

      // Notifica clientes conectados na sala para recarregar os itens
      if (created + merged > 0) {
        broadcast({
          inventoryId,
          spaceId: space.id,
          action: "items_imported",
          payload: {
            count: created + merged,
            spaceName: space.name,
            user: req.user?.fullName || req.user?.sub || "Sistema",
          },
        });
      }

      res.json({
        success: true,
        spaceName: space.name,
        summary: {
          totalRows: worksheet.rowCount - 1,
          parsedRows: rows.length,
          created,
          merged,
          skipped: skipped + duplicateRows.length,
          duplicateRows: duplicateRows.length,
          errors: errors.length + createErrors.length,
        },
        errors: [
          ...createErrors.map(e => ({ error: e })),
          ...duplicateRows,
          ...errors,
        ].slice(0, 20),
      });
    } catch (err) {
      console.error("[IMPORT-BOOKS] Error:", err.message || err);
      res.status(500).json({ error: "Erro ao importar livros", details: err.message });
    }
  },
);

// ─── GET /items/scan — localiza item por código de barras, RFID ou patrimônio ──
router.get(
  "/scan",
  verifyJWT,
  requireInventoryAccess(),
  async (req, res) => {
    try {
      const { code, spaceId } = req.query;
      if (!code) return res.status(400).json({ error: "code é obrigatório" });
      if (!spaceId) return res.status(400).json({ error: "spaceId é obrigatório" });

      const normalized = code.toString().trim();
      // Leitores podem adicionar zeros à esquerda (ex: "04685874" → salvo como "4685874").
      // Tentamos a versão exata e a versão sem zeros em todos os três campos identificadores.
      const stripped = normalized.replace(/^0+/, "") || normalized;

      const orClauses = [
        { codigoBarras: normalized },
        { codigoRFID:   normalized },
        { patrimonio:   normalized },
      ];
      if (stripped !== normalized) {
        orClauses.push({ codigoBarras: stripped });
        orClauses.push({ codigoRFID:   stripped });
        orClauses.push({ patrimonio:   stripped });
      }

      const item = await prisma.item.findFirst({
        where: {
          inventoryId: req.inventoryId,
          OR: orClauses,
        },
        include: {
          space: { select: { id: true, name: true } },
        },
      });

      if (!item) {
        return res.status(404).json({ error: "Item não encontrado para o código informado" });
      }

      res.json({
        id: item.id,
        patrimonio: item.patrimonio,
        descricao: item.descricao,
        codigoBarras: item.codigoBarras,
        codigoRFID: item.codigoRFID,
        autores: item.autores,
        anoPublicacao: item.anoPublicacao,
        numeroExemplar: item.numeroExemplar,
        statusEncontrado: item.statusEncontrado,
        spaceId: item.spaceId,
        spaceName: item.space.name,
        foundInCurrentSpace: item.spaceId === spaceId,
      });
    } catch (err) {
      console.error("[SCAN] Error:", err.message || err);
      res.status(500).json({ error: "Erro ao buscar item" });
    }
  },
);

// ─── POST /items/scan-confirm — confirma item via modo de leitura ──────────────
// Se o item está na sala atual: confirma como encontrado (ENCONTRADO_LEITURA).
// Se está em outra sala: reloca imediatamente para a sala atual + confirma
//   (ENCONTRADO_LEITURA_REALOCADO). Não usa pendingConfirm — o scan é confirmação.
router.post(
  "/scan-confirm",
  verifyJWT,
  requireInventoryAccess(),
  requireInventoryWriteAccess(),
  requireInventoryOperationalWrite(),
  async (req, res) => {
    try {
      const { itemId, spaceId: currentSpaceId, connectionId } = req.body;
      const user = req.user;

      if (!itemId) return res.status(400).json({ error: "itemId é obrigatório" });
      if (!currentSpaceId) return res.status(400).json({ error: "spaceId é obrigatório" });

      const item = await prisma.item.findUnique({
        where: { id: itemId },
        include: {
          space: { select: { id: true, name: true } },
        },
      });

      if (!item || item.inventoryId !== req.inventoryId) {
        return res.status(404).json({ error: "Item não encontrado" });
      }

      const currentSpace = await prisma.space.findFirst({
        where: { id: currentSpaceId, inventoryId: req.inventoryId },
        select: { id: true, name: true, isFinalized: true },
      });

      if (!currentSpace) {
        return res.status(400).json({ error: "Sala de destino inválida" });
      }
      if (currentSpace.isFinalized) {
        return res.status(409).json({ error: "Esta sala está finalizada" });
      }

      const isInCurrentSpace = item.spaceId === currentSpaceId;
      const originalSpaceId   = item.spaceId;
      const originalSpaceName = item.space.name;
      const now = new Date();

      await prisma.$transaction(async (tx) => {
        if (isInCurrentSpace) {
          // Confirmação simples na sala correta
          await tx.item.updateMany({
            where: { id: itemId, inventoryId: req.inventoryId },
            data: {
              statusEncontrado: "SIM",
              dataConferencia: now,
              ultimoConferente: user.sub,
            },
          });

          // Confirmar relocação pendente existente, se houver
          await tx.relocation.updateMany({
            where: { itemId, pendingConfirm: true },
            data: { pendingConfirm: false },
          });

          await recordItemHistory(tx, {
            itemId,
            fromSpaceId: item.lastKnownSpaceId || item.spaceId,
            toSpaceId: item.spaceId,
            action: "ENCONTRADO_LEITURA",
            createdBy: user.sub,
            metadata: JSON.stringify({ via: "scan" }),
          });
        } else {
          // Reloca para a sala atual + confirma imediatamente (sem pendingConfirm)
          await tx.item.updateMany({
            where: { id: itemId, inventoryId: req.inventoryId },
            data: {
              spaceId: currentSpaceId,
              lastKnownSpaceId: item.spaceId,
              statusEncontrado: "SIM",
              dataConferencia: now,
              ultimoConferente: user.sub,
            },
          });

          await tx.relocation.upsert({
            where: { itemId },
            create: {
              itemId,
              fromSpaceId: originalSpaceId,
              toSpaceId: currentSpaceId,
              movedBy: user.sub,
              movedAt: now,
              pendingConfirm: false,
            },
            update: {
              fromSpaceId: originalSpaceId,
              toSpaceId: currentSpaceId,
              movedBy: user.sub,
              movedAt: now,
              pendingConfirm: false,
            },
          });

          await recordItemHistory(tx, {
            itemId,
            fromSpaceId: originalSpaceId,
            toSpaceId: currentSpaceId,
            action: "ENCONTRADO_LEITURA_REALOCADO",
            createdBy: user.sub,
            metadata: JSON.stringify({ via: "scan", originalSpaceName }),
          });
        }
      });

      await markSpaceStarted(prisma, {
        inventoryId: req.inventoryId,
        spaceId: currentSpaceId,
        user,
      });

      const excludeClientId = connectionId
        ? `${req.inventoryId}:${user.sub}:${connectionId}`
        : undefined;

      broadcast({
        inventoryId: req.inventoryId,
        spaceId: currentSpaceId,
        action: "item_checked",
        excludeClientId,
        payload: {
          itemId,
          spaceId: currentSpaceId,
          action: isInCurrentSpace ? "ENCONTRADO_LEITURA" : "ENCONTRADO_LEITURA_REALOCADO",
          user: user.fullName || user.sub,
          timestamp: now,
        },
      });

      if (!isInCurrentSpace) {
        broadcast({
          inventoryId: req.inventoryId,
          spaceId: originalSpaceId,
          action: "item_left_space",
          excludeClientId,
          payload: {
            itemId,
            patrimonio: item.patrimonio,
            descricao: item.descricao,
            fromSpaceId: originalSpaceId,
            toSpaceId: currentSpaceId,
            user: user.fullName || user.sub,
            timestamp: now,
          },
        });
      }

      try {
        await recomputeSpaceCounters(currentSpaceId, req.inventoryId);
        if (!isInCurrentSpace) {
          await recomputeSpaceCounters(originalSpaceId, req.inventoryId);
        }
      } catch (err) {
        console.warn("[SCAN-CONFIRM] counter recompute failed:", err.message);
      }

      res.json({
        success: true,
        relocated: !isInCurrentSpace,
        originalSpaceId: isInCurrentSpace ? null : originalSpaceId,
        originalSpaceName: isInCurrentSpace ? null : originalSpaceName,
        savedAt: now,
      });
    } catch (err) {
      console.error("[SCAN-CONFIRM] Error:", err.message || err);
      res.status(500).json({ error: "Erro ao confirmar item via leitura", details: err.message });
    }
  },
);

// ─── POST /items/scan-undo — desfaz confirmação feita no modo de leitura ───────
// Recebe originalSpaceId (guardado no estado da sessão do frontend).
// Se o item foi realocado, reverte o item para a sala original.
// Registra DESFEITO_LEITURA no histórico.
router.post(
  "/scan-undo",
  verifyJWT,
  requireInventoryAccess(),
  requireInventoryWriteAccess(),
  requireInventoryOperationalWrite(),
  async (req, res) => {
    try {
      const { itemId, originalSpaceId, connectionId } = req.body;
      const user = req.user;

      if (!itemId) return res.status(400).json({ error: "itemId é obrigatório" });
      if (!originalSpaceId) return res.status(400).json({ error: "originalSpaceId é obrigatório" });

      const item = await prisma.item.findUnique({
        where: { id: itemId },
        select: {
          id: true,
          spaceId: true,
          inventoryId: true,
          statusEncontrado: true,
          patrimonio: true,
          descricao: true,
        },
      });

      if (!item || item.inventoryId !== req.inventoryId) {
        return res.status(404).json({ error: "Item não encontrado" });
      }

      const wasRelocated = item.spaceId !== originalSpaceId;
      const now = new Date();

      await prisma.$transaction(async (tx) => {
        if (wasRelocated) {
          // Reverter para a sala original e marcar como não localizado
          await tx.item.updateMany({
            where: { id: itemId, inventoryId: req.inventoryId },
            data: {
              spaceId: originalSpaceId,
              lastKnownSpaceId: item.spaceId,
              statusEncontrado: "NAO",
              dataConferencia: null,
              ultimoConferente: null,
            },
          });

          // Remover o registro de relocação criado pelo scan
          await tx.relocation.deleteMany({ where: { itemId } });
        } else {
          // Desfaz a confirmação e marca como não localizado na mesma sala
          await tx.item.updateMany({
            where: { id: itemId, inventoryId: req.inventoryId },
            data: {
              statusEncontrado: "NAO",
              dataConferencia: null,
              ultimoConferente: null,
            },
          });
        }

        await recordItemHistory(tx, {
          itemId,
          fromSpaceId: item.spaceId,
          toSpaceId: originalSpaceId,
          action: "DESFEITO_LEITURA",
          createdBy: user.sub,
          metadata: JSON.stringify({ wasRelocated }),
        });
      });

      const excludeClientId = connectionId
        ? `${req.inventoryId}:${user.sub}:${connectionId}`
        : undefined;

      broadcast({
        inventoryId: req.inventoryId,
        spaceId: originalSpaceId,
        action: "item_scan_undone",
        excludeClientId,
        payload: {
          itemId,
          spaceId: originalSpaceId,
          user: user.fullName || user.sub,
          timestamp: now,
        },
      });

      if (wasRelocated) {
        broadcast({
          inventoryId: req.inventoryId,
          spaceId: item.spaceId,
          action: "item_scan_undone",
          excludeClientId,
          payload: {
            itemId,
            spaceId: item.spaceId,
            user: user.fullName || user.sub,
            timestamp: now,
          },
        });
      }

      try {
        await recomputeSpaceCounters(originalSpaceId, req.inventoryId);
        if (wasRelocated) {
          await recomputeSpaceCounters(item.spaceId, req.inventoryId);
        }
      } catch (err) {
        console.warn("[SCAN-UNDO] counter recompute failed:", err.message);
      }

      res.json({ success: true, wasRelocated, savedAt: now });
    } catch (err) {
      console.error("[SCAN-UNDO] Error:", err.message || err);
      res.status(500).json({ error: "Erro ao desfazer leitura", details: err.message });
    }
  },
);

// ─── Duplicatas ───────────────────────────────────────────────────────────────

// GET /items/duplicates — lista todos os itens suspeitos de duplicata no inventário
router.get(
  "/duplicates",
  verifyJWT,
  requireInventoryAccess(),
  async (req, res) => {
    try {
      const items = await prisma.item.findMany({
        where: { inventoryId: req.inventoryId, isDuplicateSuspect: true },
        include: {
          space: { select: { id: true, name: true, isFinalized: true } },
          itemGroup: { select: { id: true, name: true } },
        },
        orderBy: { updatedAt: "desc" },
      });

      res.json(
        items.map((item) => ({
          id: item.id,
          patrimonio: item.patrimonio,
          descricao: item.descricao,
          statusEncontrado: item.statusEncontrado,
          condicaoVisual: item.condicaoVisual,
          duplicateNotes: item.duplicateNotes,
          space: item.space,
          itemGroup: item.itemGroup
            ? { id: item.itemGroup.id, name: item.itemGroup.name }
            : null,
          updatedAt: item.updatedAt,
        })),
      );
    } catch (err) {
      console.error("Error fetching duplicate suspects:", err);
      res.status(500).json({ error: "Erro ao carregar duplicatas suspeitas" });
    }
  },
);

// PATCH /items/:itemId/flag-duplicate — sinaliza item como suspeito de duplicata
router.patch(
  "/:itemId/flag-duplicate",
  verifyJWT,
  requireInventoryAccess(),
  requireInventoryWriteAccess(),
  async (req, res) => {
    try {
      const { itemId } = req.params;
      const { notes, observedSpaceId, connectionId } = req.body;
      const user = req.user;

      const item = await prisma.item.findFirst({
        where: { id: itemId, inventoryId: req.inventoryId },
        select: {
          id: true,
          patrimonio: true,
          descricao: true,
          spaceId: true,
          inventoryId: true,
          isDuplicateSuspect: true,
          duplicateObservedSpaceId: true,
        },
      });
      if (!item) return res.status(404).json({ error: "Item não encontrado" });

      let validObservedSpaceId = null;
      if (observedSpaceId && observedSpaceId !== item.spaceId) {
        const observedSpace = await prisma.space.findFirst({
          where: { id: observedSpaceId, inventoryId: req.inventoryId },
          select: { id: true },
        });
        if (!observedSpace) {
          return res.status(404).json({ error: "Sala de observação não encontrada" });
        }
        validObservedSpaceId = observedSpace.id;
      }

      await prisma.$transaction(async (tx) => {
        await tx.item.update({
          where: { id: itemId },
          data: {
            isDuplicateSuspect: true,
            duplicateNotes: notes?.trim() || null,
            duplicateObservedSpaceId: validObservedSpaceId,
          },
        });

        await recordItemHistory(tx, {
          itemId,
          fromSpaceId: item.spaceId,
          toSpaceId: item.spaceId,
          action: "DUPLICATA_SUSPEITA",
          reason: notes?.trim() || "Sinalizado como possível duplicata",
          createdBy: user.sub,
        });
      });

      const excludeClientId = connectionId
        ? `${req.inventoryId}:${user.sub}:${connectionId}`
        : undefined;

      broadcast({
        inventoryId: req.inventoryId,
        spaceId: item.spaceId,
        action: "item_flagged_duplicate",
        excludeClientId,
        payload: {
          itemId,
          patrimonio: item.patrimonio,
          descricao: item.descricao,
          notes: notes?.trim() || null,
          user: user.fullName || user.sub,
          timestamp: new Date(),
        },
      });
      if (validObservedSpaceId) {
        broadcast({
          inventoryId: req.inventoryId,
          spaceId: validObservedSpaceId,
          action: "item_flagged_duplicate",
          excludeClientId,
          payload: {
            itemId,
            patrimonio: item.patrimonio,
            descricao: item.descricao,
            notes: notes?.trim() || null,
            user: user.fullName || user.sub,
            timestamp: new Date(),
          },
        });
      }

      res.json({
        success: true,
        item: {
          id: item.id,
          isDuplicateSuspect: true,
          duplicateNotes: notes?.trim() || null,
          duplicateObservedSpaceId: validObservedSpaceId,
        },
      });
    } catch (err) {
      console.error("Error flagging duplicate:", err);
      res.status(500).json({ error: "Erro ao sinalizar duplicata" });
    }
  },
);

// PATCH /items/:itemId/resolve-duplicate — resolve a suspeita de duplicata
// action: "confirm" → marca como NAO + limpa flag | "dismiss" → apenas limpa flag
router.patch(
  "/:itemId/resolve-duplicate",
  verifyJWT,
  requireInventoryAccess(),
  requireInventoryWriteAccess(),
  async (req, res) => {
    try {
      const { itemId } = req.params;
      const { action, connectionId } = req.body; // action: "confirm" | "dismiss"
      const user = req.user;

      if (!["confirm", "dismiss"].includes(action)) {
        return res
          .status(400)
          .json({ error: "action deve ser 'confirm' ou 'dismiss'" });
      }

      const item = await prisma.item.findFirst({
        where: { id: itemId, inventoryId: req.inventoryId },
        select: {
          id: true,
          patrimonio: true,
          descricao: true,
          spaceId: true,
          inventoryId: true,
          isDuplicateSuspect: true,
          duplicateNotes: true,
          duplicateObservedSpaceId: true,
          space: { select: { isFinalized: true } },
        },
      });
      if (!item) return res.status(404).json({ error: "Item não encontrado" });
      if (!item.isDuplicateSuspect) {
        return res
          .status(400)
          .json({ error: "Este item não está sinalizado como duplicata suspeita" });
      }

      const historyAction =
        action === "confirm" ? "DUPLICATA_CONFIRMADA" : "DUPLICATA_DISPENSADA";
      const historyReason =
        action === "confirm"
          ? "Duplicata confirmada — item marcado como não localizado"
          : "Suspeita de duplicata dispensada — item retorna ao fluxo normal";

      await prisma.$transaction(async (tx) => {
        await tx.item.update({
          where: { id: itemId },
          data: {
            isDuplicateSuspect: false,
            duplicateNotes: null,
            duplicateObservedSpaceId: null,
            ...(action === "confirm" && { statusEncontrado: "NAO" }),
          },
        });

        await recordItemHistory(tx, {
          itemId,
          fromSpaceId: item.spaceId,
          toSpaceId: item.spaceId,
          action: historyAction,
          reason: historyReason,
          createdBy: user.sub,
        });
      });

      const excludeClientId = connectionId
        ? `${req.inventoryId}:${user.sub}:${connectionId}`
        : undefined;

      broadcast({
        inventoryId: req.inventoryId,
        spaceId: item.spaceId,
        action: "item_duplicate_resolved",
        excludeClientId,
        payload: {
          itemId,
          patrimonio: item.patrimonio,
          descricao: item.descricao,
          resolution: action,
          user: user.fullName || user.sub,
          timestamp: new Date(),
        },
      });
      if (item.duplicateObservedSpaceId) {
        broadcast({
          inventoryId: req.inventoryId,
          spaceId: item.duplicateObservedSpaceId,
          action: "item_duplicate_resolved",
          excludeClientId,
          payload: {
            itemId,
            patrimonio: item.patrimonio,
            descricao: item.descricao,
            resolution: action,
            user: user.fullName || user.sub,
            timestamp: new Date(),
          },
        });
      }

      res.json({ success: true, action });
    } catch (err) {
      console.error("Error resolving duplicate:", err);
      res.status(500).json({ error: "Erro ao resolver duplicata" });
    }
  },
);

export default router;
