import { Router } from "express";
import { verifyJWT } from "../middleware/auth.js";
import {
  requireInventoryAccess,
  requireInventoryWriteAccess,
  requireInventoryOperationalWrite,
} from "../middleware/inventory.js";
import { prisma } from "../prisma/client.js";
import { recordItemHistory } from "../services/audit.js";
import { broadcast } from "../services/sse.js";
import { recomputeSpaceCounters } from "../services/metrics.js";

const router = Router();

// GET /api/item-groups/all
router.get(
  "/all",
  verifyJWT,
  requireInventoryAccess(),
  async (req, res) => {
    try {
      const groups = await prisma.itemGroup.findMany({
        where: { inventoryId: req.inventoryId },
        include: {
          _count: { select: { items: true } },
          items: {
            select: {
              id: true,
              patrimonio: true,
              descricao: true,
              spaceId: true,
              space: { select: { name: true, isFinalized: true } },
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

// POST /api/item-groups — create group
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
        where: { id: { in: itemIds }, inventoryId: req.inventoryId },
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
          items: { connect: itemIds.map((id) => ({ id })) },
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

// PUT /api/item-groups/:groupId — rename / update description / add/remove items
router.put(
  "/:groupId",
  verifyJWT,
  requireInventoryAccess(),
  requireInventoryWriteAccess(),
  async (req, res) => {
    try {
      const { groupId } = req.params;
      const { name, description, addItemIds, removeItemIds } = req.body;

      const group = await prisma.itemGroup.findFirst({
        where: { id: groupId, inventoryId: req.inventoryId },
        select: { id: true },
      });
      if (!group) return res.status(404).json({ error: "Grupo não encontrado" });

      const updated = await prisma.itemGroup.update({
        where: { id: groupId },
        data: {
          ...(name !== undefined && { name: name.trim() }),
          ...(description !== undefined && {
            description: description?.trim() || null,
          }),
          ...(Array.isArray(addItemIds) &&
            addItemIds.length > 0 && {
              items: { connect: addItemIds.map((id) => ({ id })) },
            }),
          ...(Array.isArray(removeItemIds) &&
            removeItemIds.length > 0 && {
              items: { disconnect: removeItemIds.map((id) => ({ id })) },
            }),
        },
        include: {
          _count: { select: { items: true } },
          items: {
            select: {
              id: true,
              patrimonio: true,
              descricao: true,
              spaceId: true,
              space: { select: { name: true, isFinalized: true } },
              statusEncontrado: true,
            },
          },
        },
      });

      broadcast({
        inventoryId: req.inventoryId,
        action: "group_updated",
        payload: { groupId, name: updated.name },
      });

      res.json(updated);
    } catch (err) {
      console.error("Error updating item group:", err);
      res.status(500).json({ error: "Erro ao atualizar grupo de itens" });
    }
  },
);

// POST /api/item-groups/:groupId/split — move subset of items into a new group
router.post(
  "/:groupId/split",
  verifyJWT,
  requireInventoryAccess(),
  requireInventoryWriteAccess(),
  async (req, res) => {
    try {
      const { groupId } = req.params;
      const { splitItemIds, newGroupName, newGroupDescription } = req.body;

      if (!Array.isArray(splitItemIds) || splitItemIds.length === 0 || !newGroupName) {
        return res.status(400).json({
          error: "splitItemIds (array não vazio) e newGroupName são obrigatórios",
        });
      }

      const group = await prisma.itemGroup.findFirst({
        where: { id: groupId, inventoryId: req.inventoryId },
        include: { items: { select: { id: true } } },
      });
      if (!group) return res.status(404).json({ error: "Grupo não encontrado" });

      const validIds = new Set(group.items.map((i) => i.id));
      const invalid = splitItemIds.filter((id) => !validIds.has(id));
      if (invalid.length > 0) {
        return res
          .status(400)
          .json({ error: "Um ou mais itens não pertencem a este grupo" });
      }

      if (splitItemIds.length >= group.items.length) {
        return res
          .status(400)
          .json({ error: "É necessário manter ao menos 1 item no grupo original" });
      }

      const newGroup = await prisma.itemGroup.create({
        data: {
          name: newGroupName.trim(),
          description: newGroupDescription?.trim() || null,
          inventoryId: req.inventoryId,
          items: { connect: splitItemIds.map((id) => ({ id })) },
        },
        include: {
          _count: { select: { items: true } },
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

      broadcast({
        inventoryId: req.inventoryId,
        action: "group_split",
        payload: {
          originalGroupId: groupId,
          newGroupId: newGroup.id,
          newGroupName: newGroup.name,
        },
      });

      res.status(201).json({ originalGroupId: groupId, newGroup });
    } catch (err) {
      console.error("Error splitting item group:", err);
      res.status(500).json({ error: "Erro ao dividir grupo de itens" });
    }
  },
);

// POST /api/item-groups/pull-item — pull a specific item from a group by patrimônio
// If the item is in a finalized room, attempt substitution from the same group.
router.post(
  "/pull-item",
  verifyJWT,
  requireInventoryAccess(),
  requireInventoryWriteAccess(),
  requireInventoryOperationalWrite(),
  async (req, res) => {
    try {
      const { itemGroupId, patrimonio, targetSpaceId, connectionId } = req.body;
      const user = req.user;

      if (!itemGroupId || !patrimonio || !targetSpaceId) {
        return res.status(400).json({
          error: "itemGroupId, patrimonio e targetSpaceId são obrigatórios",
        });
      }

      // Find the item by patrimônio inside the group
      const item = await prisma.item.findFirst({
        where: {
          inventoryId: req.inventoryId,
          itemGroupId,
          patrimonio: patrimonio.toString().trim(),
        },
        include: {
          space: {
            select: { id: true, name: true, isFinalized: true, observacoes: true },
          },
          itemGroup: { select: { id: true, name: true } },
        },
      });

      if (!item) {
        return res.status(404).json({
          error: `Item com patrimônio ${patrimonio} não encontrado no grupo informado`,
        });
      }

      const targetSpace = await prisma.space.findFirst({
        where: { id: targetSpaceId, inventoryId: req.inventoryId },
        select: { id: true, name: true, isFinalized: true },
      });

      if (!targetSpace) {
        return res.status(400).json({ error: "Espaço de destino inválido" });
      }
      if (targetSpace.isFinalized) {
        return res
          .status(409)
          .json({ error: "A sala de destino está finalizada e não pode receber itens" });
      }
      if (item.spaceId === targetSpaceId) {
        return res.status(400).json({ error: "O item já está nesta sala" });
      }

      const sourceSpace = item.space;
      const movedAt = new Date();
      const actorName = user.fullName || user.sub;

      const excludeClientId = connectionId
        ? `${req.inventoryId}:${user.sub}:${connectionId}`
        : undefined;

      // ─── Case 1: source room is NOT finalized — simple pull ──────────────────
      if (!sourceSpace.isFinalized) {
        await prisma.$transaction(async (tx) => {
          await tx.item.update({
            where: { id: item.id },
            data: {
              spaceId: targetSpaceId,
              lastKnownSpaceId: sourceSpace.id,
              statusEncontrado: "PENDENTE",
            },
          });

          await recordItemHistory(tx, {
            itemId: item.id,
            fromSpaceId: sourceSpace.id,
            toSpaceId: targetSpaceId,
            action: "PUXADO_DO_GRUPO",
            reason: `Item puxado individualmente do grupo "${item.itemGroup.name}" por ${actorName}`,
            createdBy: user.sub,
            metadata: JSON.stringify({ groupId: itemGroupId }),
          });
        });

        broadcast({
          inventoryId: req.inventoryId,
          spaceId: sourceSpace.id,
          action: "item_left_space",
          excludeClientId,
          payload: {
            itemId: item.id,
            patrimonio: item.patrimonio,
            toSpaceName: targetSpace.name,
            user: actorName,
            timestamp: movedAt,
          },
        });
        broadcast({
          inventoryId: req.inventoryId,
          spaceId: targetSpaceId,
          action: "item_relocated",
          excludeClientId,
          payload: {
            itemId: item.id,
            patrimonio: item.patrimonio,
            fromSpaceName: sourceSpace.name,
            user: actorName,
            timestamp: movedAt,
          },
        });

        try {
          await recomputeSpaceCounters(sourceSpace.id, req.inventoryId);
          await recomputeSpaceCounters(targetSpaceId, req.inventoryId);
        } catch (_) {}

        return res.json({
          success: true,
          type: "simple_pull",
          item: { id: item.id, patrimonio: item.patrimonio, descricao: item.descricao },
          sourceSpace: { id: sourceSpace.id, name: sourceSpace.name },
          targetSpace: { id: targetSpaceId, name: targetSpace.name },
        });
      }

      // ─── Case 2: source room IS finalized ─────────────────────────────────────
      // Try to find a replacement from the same group:
      //   - statusEncontrado = "NAO" (not yet found), OR
      //   - currently in a room that is NOT finalized
      const replacement = await prisma.item.findFirst({
        where: {
          inventoryId: req.inventoryId,
          itemGroupId,
          id: { not: item.id },
          OR: [
            { statusEncontrado: "NAO" },
            { space: { isFinalized: false } },
          ],
        },
        include: {
          space: { select: { id: true, name: true } },
        },
        orderBy: [{ statusEncontrado: "asc" }, { patrimonio: "asc" }],
      });

      if (replacement) {
        // ─── Case 2a: substitution available ──────────────────────────────────
        await prisma.$transaction(async (tx) => {
          // Pull original item to target room
          await tx.item.update({
            where: { id: item.id },
            data: {
              spaceId: targetSpaceId,
              lastKnownSpaceId: sourceSpace.id,
              statusEncontrado: "PENDENTE",
            },
          });

          // Move replacement into the sealed room
          await tx.item.update({
            where: { id: replacement.id },
            data: {
              spaceId: sourceSpace.id,
              lastKnownSpaceId: replacement.spaceId,
              statusEncontrado: "NAO",
            },
          });

          await recordItemHistory(tx, {
            itemId: item.id,
            fromSpaceId: sourceSpace.id,
            toSpaceId: targetSpaceId,
            action: "PUXADO_DO_GRUPO_SALA_LACRADA",
            reason: `Item puxado de sala lacrada "${sourceSpace.name}". Substituído por patrimônio ${replacement.patrimonio} do mesmo grupo "${item.itemGroup.name}"`,
            createdBy: user.sub,
            metadata: JSON.stringify({
              groupId: itemGroupId,
              sealedRoomId: sourceSpace.id,
              sealedRoomName: sourceSpace.name,
              replacementItemId: replacement.id,
              replacementPatrimonio: replacement.patrimonio,
            }),
          });

          await recordItemHistory(tx, {
            itemId: replacement.id,
            fromSpaceId: replacement.space.id,
            toSpaceId: sourceSpace.id,
            action: "SUBSTITUIÇÃO_EM_SALA_LACRADA",
            reason: `Substituiu patrimônio ${item.patrimonio} na sala lacrada "${sourceSpace.name}" (grupo "${item.itemGroup.name}")`,
            createdBy: user.sub,
            metadata: JSON.stringify({
              groupId: itemGroupId,
              sealedRoomId: sourceSpace.id,
              sealedRoomName: sourceSpace.name,
              replacedItemId: item.id,
              replacedPatrimonio: item.patrimonio,
            }),
          });
        });

        // Broadcast original item leaving sealed room and arriving at target
        broadcast({
          inventoryId: req.inventoryId,
          spaceId: sourceSpace.id,
          action: "item_left_space",
          excludeClientId,
          payload: {
            itemId: item.id,
            patrimonio: item.patrimonio,
            toSpaceName: targetSpace.name,
            user: actorName,
            timestamp: movedAt,
          },
        });
        broadcast({
          inventoryId: req.inventoryId,
          spaceId: targetSpaceId,
          action: "item_relocated",
          excludeClientId,
          payload: {
            itemId: item.id,
            patrimonio: item.patrimonio,
            fromSpaceName: sourceSpace.name,
            user: actorName,
            timestamp: movedAt,
          },
        });
        // Broadcast replacement entering sealed room
        broadcast({
          inventoryId: req.inventoryId,
          spaceId: sourceSpace.id,
          action: "item_relocated",
          payload: {
            itemId: replacement.id,
            patrimonio: replacement.patrimonio,
            fromSpaceName: replacement.space.name,
            substitution: true,
            user: actorName,
            timestamp: movedAt,
          },
        });
        broadcast({
          inventoryId: req.inventoryId,
          spaceId: replacement.space.id,
          action: "item_left_space",
          payload: {
            itemId: replacement.id,
            patrimonio: replacement.patrimonio,
            toSpaceName: sourceSpace.name,
            substitution: true,
            user: actorName,
            timestamp: movedAt,
          },
        });

        try {
          await recomputeSpaceCounters(sourceSpace.id, req.inventoryId);
          await recomputeSpaceCounters(targetSpaceId, req.inventoryId);
          await recomputeSpaceCounters(replacement.space.id, req.inventoryId);
        } catch (_) {}

        return res.json({
          success: true,
          type: "substituted",
          item: { id: item.id, patrimonio: item.patrimonio, descricao: item.descricao },
          replacement: {
            id: replacement.id,
            patrimonio: replacement.patrimonio,
            fromSpaceName: replacement.space.name,
          },
          sourceSpace: { id: sourceSpace.id, name: sourceSpace.name },
          targetSpace: { id: targetSpaceId, name: targetSpace.name },
          message: `Patrimônio ${item.patrimonio} puxado. Patrimônio ${replacement.patrimonio} foi deslocado como substituto para a sala "${sourceSpace.name}".`,
        });
      }

      // ─── Case 2b: no replacement available ────────────────────────────────────
      const timestamp = new Date().toLocaleString("pt-BR", {
        day: "2-digit",
        month: "2-digit",
        year: "numeric",
        hour: "2-digit",
        minute: "2-digit",
      });
      const nota = `\n[${timestamp}] Item patrimônio ${item.patrimonio} foi removido automaticamente pelo sistema, pois foi localizado na sala "${targetSpace.name}". Nenhum substituto disponível no grupo "${item.itemGroup.name}". É necessário incluir outro item nesta sala.`;

      await prisma.$transaction(async (tx) => {
        await tx.item.update({
          where: { id: item.id },
          data: {
            spaceId: targetSpaceId,
            lastKnownSpaceId: sourceSpace.id,
            statusEncontrado: "PENDENTE",
          },
        });

        await tx.space.update({
          where: { id: sourceSpace.id },
          data: {
            observacoes: (sourceSpace.observacoes || "").trim()
              ? sourceSpace.observacoes + nota
              : nota.trimStart(),
          },
        });

        await recordItemHistory(tx, {
          itemId: item.id,
          fromSpaceId: sourceSpace.id,
          toSpaceId: targetSpaceId,
          action: "PUXADO_DO_GRUPO_SEM_SUBSTITUTO",
          reason: `Item puxado de sala lacrada "${sourceSpace.name}" sem substituto disponível no grupo "${item.itemGroup.name}". Observação adicionada à sala.`,
          createdBy: user.sub,
          metadata: JSON.stringify({
            groupId: itemGroupId,
            sealedRoomId: sourceSpace.id,
            sealedRoomName: sourceSpace.name,
          }),
        });
      });

      broadcast({
        inventoryId: req.inventoryId,
        spaceId: sourceSpace.id,
        action: "item_left_space",
        excludeClientId,
        payload: {
          itemId: item.id,
          patrimonio: item.patrimonio,
          toSpaceName: targetSpace.name,
          noReplacement: true,
          user: actorName,
          timestamp: movedAt,
        },
      });
      broadcast({
        inventoryId: req.inventoryId,
        spaceId: targetSpaceId,
        action: "item_relocated",
        excludeClientId,
        payload: {
          itemId: item.id,
          patrimonio: item.patrimonio,
          fromSpaceName: sourceSpace.name,
          user: actorName,
          timestamp: movedAt,
        },
      });

      try {
        await recomputeSpaceCounters(sourceSpace.id, req.inventoryId);
        await recomputeSpaceCounters(targetSpaceId, req.inventoryId);
      } catch (_) {}

      return res.json({
        success: true,
        type: "no_replacement",
        item: { id: item.id, patrimonio: item.patrimonio, descricao: item.descricao },
        sourceSpace: { id: sourceSpace.id, name: sourceSpace.name },
        targetSpace: { id: targetSpaceId, name: targetSpace.name },
        warning: `Nenhum substituto disponível no grupo. A sala "${sourceSpace.name}" recebeu um aviso nas observações.`,
        message: `Patrimônio ${item.patrimonio} removido da sala lacrada "${sourceSpace.name}". É necessário incluir manualmente um substituto naquela sala.`,
      });
    } catch (err) {
      console.error("Error pulling item from group:", err);
      res.status(500).json({ error: "Erro ao puxar item do grupo" });
    }
  },
);

// DELETE /api/item-groups/:groupId
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
        select: { id: true, name: true },
      });

      if (!group) {
        return res.status(404).json({ error: "Grupo não encontrado" });
      }

      await prisma.itemGroup.delete({ where: { id: groupId } });

      broadcast({
        inventoryId: req.inventoryId,
        action: "group_deleted",
        payload: { groupId, name: group.name },
      });

      res.json({ success: true });
    } catch (err) {
      console.error("Error deleting item group:", err);
      res.status(500).json({ error: "Erro ao deletar grupo de itens" });
    }
  },
);

export default router;
