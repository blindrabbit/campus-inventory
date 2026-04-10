import { Router } from "express";
import { verifyJWT } from "../middleware/auth.js";
import {
  requireInventoryAccess,
  requireInventoryOperationalWrite,
  requireInventoryWriteAccess,
} from "../middleware/inventory.js";
import { prisma } from "../prisma/client.js";
import { recordItemHistory } from "../services/audit.js";

const router = Router();

function normalizePatrimonioNumber(value) {
  if (value === null || value === undefined) return null;
  const digits = value.toString().trim().replace(/\D/g, "");
  if (!digits) return null;
  const parsed = Number.parseInt(digits, 10);
  if (Number.isNaN(parsed)) return null;
  return parsed;
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
          },
        },
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
      meta: item.relocationIn
        ? {
            isRelocated: true,
            fromSpaceName: item.relocationIn.fromSpace.name,
            movedBy: item.relocationIn.movedBy,
            pendingConfirm: item.relocationIn.pendingConfirm,
          }
        : null,
    }));

    res.json(formatted);
  } catch (err) {
    console.error("Error fetching items:", err);
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
      OR: [{ patrimonio: { contains: q } }, { descricao: { contains: q } }],
      ...(excludeSpaceId ? { NOT: { spaceId: excludeSpaceId } } : {}),
    };

    const matches = await prisma.item.findMany({
      where,
      select: {
        id: true,
        patrimonio: true,
        descricao: true,
        spaceId: true,
        space: {
          select: {
            id: true,
            name: true,
          },
        },
      },
      take: 20,
      orderBy: { patrimonio: "asc" },
    });

    res.json(
      matches.map((item) => ({
        id: item.id,
        patrimonio: item.patrimonio,
        descricao: item.descricao,
        spaceId: item.spaceId,
        spaceName: item.space?.name || "Sem localização",
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
      const { itemId, condicao } = req.body;
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
      const { itemId, targetSpaceId } = req.body;
      const user = req.user;

      const item = await prisma.item.findUnique({
        where: { id: itemId },
        select: {
          id: true,
          spaceId: true,
          lastKnownSpaceId: true,
          inventoryId: true,
        },
      });

      if (!item || item.inventoryId !== req.inventoryId) {
        return res.status(404).json({ error: "Item não encontrado" });
      }

      const targetSpace = await prisma.space.findFirst({
        where: { id: targetSpaceId, inventoryId: req.inventoryId },
        select: { id: true },
      });

      if (!targetSpace) {
        return res.status(400).json({ error: "Espaço de destino inválido" });
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

        await tx.relocation.upsert({
          where: { itemId },
          create: {
            itemId,
            fromSpaceId: item.spaceId,
            toSpaceId: targetSpaceId,
            movedBy: user.sub,
            movedAt,
            pendingConfirm: true,
          },
          update: {
            fromSpaceId: item.spaceId,
            toSpaceId: targetSpaceId,
            movedBy: user.sub,
            movedAt,
            pendingConfirm: true,
          },
        });

        await recordItemHistory(tx, {
          itemId,
          fromSpaceId: item.spaceId,
          toSpaceId: targetSpaceId,
          action: "REALOCADO",
          createdBy: user.sub,
        });
      });

      await markSpaceStarted(prisma, {
        inventoryId: req.inventoryId,
        spaceId: item.spaceId,
        user,
      });

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

export default router;
