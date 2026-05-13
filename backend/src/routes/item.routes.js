import { Router } from "express";
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

    const items = await prisma.item.findMany({
      where: {
        inventoryId: req.inventoryId,
        spaceId,
        statusEncontrado: { not: "NAO" },
      },
      include: {
        relocationIn: {
          select: {
            fromSpace: { select: { name: true } },
            movedBy: true,
            pendingConfirm: true,
            wasUnfound: true,
          },
        },
        itemGroup: { select: { id: true, name: true } },
      },
    });

    const formatted = items.map((item) => ({
      id: item.id,
      patrimonio: item.patrimonio,
      descricao: item.descricao,
      condicaoOriginal: item.condicaoOriginal,
      valor: item.valor,
      codigoSIA: item.codigoSIA,
      fornecedor: item.fornecedor,
      dataAquisicao: item.dataAquisicao,
      documento: item.documento,
      statusEncontrado: item.statusEncontrado,
      condicaoVisual: item.condicaoVisual,
      dataConferencia: item.dataConferencia,
      ultimoConferente: item.ultimoConferente,
      verificationStatus: item.verificationStatus,
      verifiedAt: item.verifiedAt,
      verifiedBy: item.verifiedBy,
      itemGroupId: item.itemGroup?.id || null,
      groupName: item.itemGroup?.name || null,
      meta: item.relocationIn
        ? {
            isRelocated: item.relocationIn.pendingConfirm,
            fromSpaceName: item.relocationIn.fromSpace.name,
            movedBy: item.relocationIn.movedBy,
            pendingConfirm: item.relocationIn.pendingConfirm,
            wasUnfound: item.relocationIn.wasUnfound,
          }
        : null,
    }));

    res.json(formatted);
  } catch (err) {
    console.error("Error fetching items:", err);
    res.status(500).json({ error: "Erro ao carregar itens" });
  }
});

router.get("/all", verifyJWT, requireInventoryAccess(), async (req, res) => {
  try {
    const items = await prisma.item.findMany({
      where: { inventoryId: req.inventoryId },
      select: {
        id: true,
        patrimonio: true,
        descricao: true,
        spaceId: true,
        statusEncontrado: true,
        condicaoVisual: true,
        space: {
          select: {
            id: true,
            name: true,
            isFinalized: true,
            isVerifiedByRevisor: true,
          },
        },
      },
      orderBy: { patrimonio: "asc" },
    });

    res.json(items);
  } catch (err) {
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

    const normalizedQuery = normalizeString(q);
    const queryAsNumber = normalizePatrimonioNumber(q);

    const where = {
      inventoryId: req.inventoryId,
      ...(excludeSpaceId ? { NOT: { spaceId: excludeSpaceId } } : {}),
    };

    // Get all items (or a large batch) to search client-side
    const matches = await prisma.item.findMany({
      where,
      select: {
        id: true,
        patrimonio: true,
        descricao: true,
        spaceId: true,
        statusEncontrado: true,
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
      },
    });

    // Filter and score results with priority: patrimonio > descricao
    const scored = matches
      .map((item) => {
        const normalizedPatrimonio = normalizeString(item.patrimonio || "");
        const normalizedDescricao = normalizeString(item.descricao || "");
        const itemPatrimonioNumber = normalizePatrimonioNumber(item.patrimonio);

        // Priority scoring:
        // 0. Patrimonio exact match (numeric): highest priority
        // 1. Patrimonio exact match (text): high priority
        // 2. Patrimonio starts with: medium-high priority
        // 3. Patrimonio contains: medium priority
        // 4. Description starts with: medium-low priority
        // 5. Description contains: low priority
        // 999. No match

        let priority = 999;

        // Numeric exact match is highest priority
        if (
          queryAsNumber !== null &&
          itemPatrimonioNumber !== null &&
          itemPatrimonioNumber === queryAsNumber
        ) {
          priority = 0;
        } else if (normalizedPatrimonio === normalizedQuery) {
          priority = 1;
        } else if (normalizedPatrimonio.startsWith(normalizedQuery)) {
          priority = 2;
        } else if (normalizedPatrimonio.includes(normalizedQuery)) {
          priority = 3;
        } else if (normalizedDescricao.startsWith(normalizedQuery)) {
          priority = 4;
        } else if (normalizedDescricao.includes(normalizedQuery)) {
          priority = 5;
        }

        return { item, priority };
      })
      .filter((scored) => scored.priority !== 999)
      .sort((a, b) => {
        if (a.priority !== b.priority) {
          return a.priority - b.priority;
        }
        // Same priority: sort by patrimonio numerically
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
      .map(({ item }) => item);

    res.json(
      scored.map((item) => ({
        id: item.id,
        patrimonio: item.patrimonio,
        descricao: item.descricao,
        spaceId: item.spaceId,
        spaceName: item.space?.name || "Sem localização",
        statusEncontrado: item.statusEncontrado,
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
      })),
    );
  } catch (err) {
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
        },
      });

      if (!item || item.inventoryId !== req.inventoryId) {
        return res.status(404).json({ error: "Item não encontrado" });
      }

      const targetSpace = await prisma.space.findFirst({
        where: { id: targetSpaceId, inventoryId: req.inventoryId },
        select: { id: true, isFinalized: true },
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
        select: { isFinalized: true },
      });
      if (sourceSpace?.isFinalized && item.statusEncontrado !== "NAO") {
        return res
          .status(409)
          .json({
            error: "Esta sala está finalizada e não pode ter itens removidos",
          });
      }

      if (item.spaceId === targetSpaceId) {
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
          fromSpaceId: item.spaceId,
          toSpaceId: targetSpaceId,
          action: "REALOCADO",
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
          where: { id: targetSpaceId, inventoryId: req.inventoryId },
          select: { id: true, isFinalized: true },
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
        select: { isFinalized: true },
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
          itemIds: itemIds,
          fromSpaceId: sourceSpaceId,
          toSpaceId: targetSpaceId,
          action: "REALOCADO",
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
          select: { id: true, isFinalized: true },
        }),
        prisma.space.findFirst({
          where: { id: targetSpaceId, inventoryId: req.inventoryId },
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
          toSpaceId: targetSpaceId,
          action: "REALOCADO",
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

export default router;
