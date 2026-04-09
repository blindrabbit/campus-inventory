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

      const checked = await prisma.item.updateMany({
        where: { id: itemId, inventoryId: req.inventoryId },
        data: {
          statusEncontrado: "SIM",
          condicaoVisual: condicao,
          dataConferencia: new Date(),
          ultimoConferente: user.sub,
        },
      });

      if (checked.count === 0) {
        return res.status(404).json({ error: "Item não encontrado" });
      }

      await prisma.relocation.updateMany({
        where: { itemId, pendingConfirm: true },
        data: { pendingConfirm: false },
      });

      await recordItemHistory(prisma, {
        itemId,
        action: "ENCONTRADO",
        createdBy: user.sub,
        metadata: { condicao },
      });

      res.json({ success: true, savedAt: new Date() });
    } catch (err) {
      console.error("Error checking item:", err);
      res.status(500).json({ error: "Erro ao confirmar item" });
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

      await prisma.item.updateMany({
        where: { id: itemId, inventoryId: req.inventoryId },
        data: {
          spaceId: targetSpaceId,
          lastKnownSpaceId: item.spaceId,
          statusEncontrado: "PENDENTE",
        },
      });

      await prisma.relocation.create({
        data: {
          itemId,
          fromSpaceId: item.spaceId,
          toSpaceId: targetSpaceId,
          movedBy: user.sub,
          pendingConfirm: true,
        },
      });

      await recordItemHistory(prisma, {
        itemId,
        fromSpaceId: item.spaceId,
        toSpaceId: targetSpaceId,
        action: "REALOCADO",
        createdBy: user.sub,
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

      res.json({ success: true });
    } catch (err) {
      console.error("Error marking item unfound:", err);
      res.status(500).json({ error: "Erro ao marcar item" });
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
        select: { lastKnownSpaceId: true, inventoryId: true },
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
        fromSpaceId: item.lastKnownSpaceId,
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

export default router;
