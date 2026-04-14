import { Router } from "express";
import { verifyJWT } from "../middleware/auth.js";
import {
  requireInventoryAccess,
  requireInventoryWriteAccess,
} from "../middleware/inventory.js";
import { prisma } from "../prisma/client.js";

const router = Router();

router.get(
  "/all",
  verifyJWT,
  requireInventoryAccess(),
  async (req, res) => {
    try {
      const groups = await prisma.itemGroup.findMany({
        where: { inventoryId: req.inventoryId },
        include: {
          items: {
            select: {
              id: true,
              patrimonio: true,
              descricao: true,
              spaceId: true,
              space: { select: { name: true } },
              condicaoVisual: true,
              statusEncontrado: true,
            },
          },
        },
        orderBy: { name: "asc" },
      });

      res.json(groups);
    } catch (err) {
      console.error("Error fetching item groups:", err);
      res.status(500).json({ error: "Erro ao carregar grupos de itens" });
    }
  },
);

router.post(
  "/",
  verifyJWT,
  requireInventoryAccess(),
  requireInventoryWriteAccess(),
  async (req, res) => {
    try {
      const { name, description, itemIds } = req.body;

      if (!name || !Array.isArray(itemIds) || itemIds.length === 0) {
        return res.status(400).json({
          error: "name e itemIds (array não vazio) são obrigatórios",
        });
      }

      const validItems = await prisma.item.findMany({
        where: {
          id: { in: itemIds },
          inventoryId: req.inventoryId,
        },
        select: { id: true },
      });

      if (validItems.length !== itemIds.length) {
        return res.status(400).json({ error: "Um ou mais itens são inválidos" });
      }

      const group = await prisma.itemGroup.create({
        data: {
          name: name.trim(),
          description: description?.trim() || null,
          inventoryId: req.inventoryId,
          items: {
            connect: itemIds.map((id) => ({ id })),
          },
        },
        include: {
          items: {
            select: {
              id: true,
              patrimonio: true,
              descricao: true,
              spaceId: true,
              statusEncontrado: true,
            },
          },
        },
      });

      res.status(201).json(group);
    } catch (err) {
      console.error("Error creating item group:", err);
      res.status(500).json({ error: "Erro ao criar grupo de itens" });
    }
  },
);

router.delete(
  "/:groupId",
  verifyJWT,
  requireInventoryAccess(),
  requireInventoryWriteAccess(),
  async (req, res) => {
    try {
      const { groupId } = req.params;

      const group = await prisma.itemGroup.findFirst({
        where: { id: groupId, inventoryId: req.inventoryId },
        select: { id: true },
      });

      if (!group) {
        return res.status(404).json({ error: "Grupo não encontrado" });
      }

      await prisma.itemGroup.delete({ where: { id: groupId } });

      res.json({ success: true });
    } catch (err) {
      console.error("Error deleting item group:", err);
      res.status(500).json({ error: "Erro ao deletar grupo de itens" });
    }
  },
);

export default router;
