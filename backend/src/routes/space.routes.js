import { Router } from "express";
import { verifyJWT, requireRole } from "../middleware/auth.js";
import {
  requireInventoryAccess,
  requireInventoryOperationalWrite,
  requireInventoryWriteAccess,
  requireInventoryRoles,
  requireVerificationAccess,
  requireNotRevisor,
} from "../middleware/inventory.js";
import { prisma } from "../prisma/client.js";

const router = Router();

function canResolveResponsible(value) {
  if (!value) return false;
  const normalized = value.toString().trim();
  if (!normalized || normalized.toLowerCase() === "não informado") return false;
  return true;
}

async function buildResponsibleLabels(spaces) {
  const uniqueResponsible = [
    ...new Set(
      spaces
        .map((space) => space.responsible)
        .filter((value) => canResolveResponsible(value)),
    ),
  ];

  const labels = new Map();

  if (uniqueResponsible.length === 0) {
    return labels;
  }

  const localUsers = await prisma.user.findMany({
    where: {
      samAccountName: {
        in: uniqueResponsible,
      },
    },
    select: {
      samAccountName: true,
      fullName: true,
    },
  });

  const localMap = new Map(
    localUsers.map((user) => [
      user.samAccountName?.toLowerCase(),
      user.fullName || user.samAccountName,
    ]),
  );

  uniqueResponsible.forEach((responsible) => {
    const localName = localMap.get(responsible.toLowerCase());
    labels.set(responsible, localName || responsible);
  });

  return labels;
}

async function resolveUserNames(samAccountNames) {
  const unique = [...new Set(samAccountNames.filter(Boolean))];
  if (unique.length === 0) return new Map();
  const users = await prisma.user.findMany({
    where: { samAccountName: { in: unique } },
    select: { samAccountName: true, fullName: true },
  });
  return new Map(users.map((u) => [u.samAccountName, u.fullName || u.samAccountName]));
}

async function ensureUniqueSpaceName(name, inventoryId, excludeId = null) {
  const existing = excludeId
    ? await prisma.$queryRaw`
        SELECT id FROM spaces
        WHERE lower(name) = lower(${name})
          AND inventoryId = ${inventoryId}
          AND id <> ${excludeId}
        LIMIT 1
      `
    : await prisma.$queryRaw`
        SELECT id FROM spaces
        WHERE lower(name) = lower(${name})
          AND inventoryId = ${inventoryId}
        LIMIT 1
      `;

  return existing[0] || null;
}

router.get("/active", verifyJWT, requireInventoryAccess(), async (req, res) => {
  try {
    const q = req.query.q?.toString().trim();
    const includeFinalized = req.query.includeFinalized === "true";

    const where = {
      inventoryId: req.inventoryId,
      isActive: true,
      ...(includeFinalized ? {} : { isFinalized: false }),
      ...(q
        ? {
            name: { contains: q },
          }
        : {}),
    };

    const spaces = await prisma.space.findMany({
      where,
      include: {
        _count: {
          select: {
            items: {
              where: {
                statusEncontrado: { not: "NAO" },
              },
            },
          },
        },
        verificationRolls: {
          where: { result: "PASSED" },
          select: { id: true },
          take: 1,
        },
        finalizationHistory: {
          where: { action: { in: ["FINALIZED", "COMPLETED_VERIFICATION"] } },
          orderBy: { actedAt: "desc" },
          select: { action: true, actedBy: true, actedAt: true },
        },
      },
      orderBy: { name: "asc" },
      take: q ? 10 : undefined,
    });

    const responsibleLabels = await buildResponsibleLabels(spaces);

    // Collect all samAccountNames from finalizationHistory to resolve names in one query
    const allActors = spaces.flatMap((s) =>
      s.finalizationHistory.map((h) => h.actedBy),
    );
    const actorNames = await resolveUserNames(allActors);

    const formatted = spaces.map((s) => {
      const finalizedEntry = s.finalizationHistory.find(
        (h) => h.action === "FINALIZED",
      );
      const confirmedEntry = s.finalizationHistory.find(
        (h) => h.action === "COMPLETED_VERIFICATION",
      );

      return {
        executionStatus: s.isFinalized
          ? "FINALIZADO"
          : s.startedAt
            ? "INICIADO"
            : "NAO_INICIADO",
        id: s.id,
        name: s.name,
        responsible: s.responsible,
        responsibleName: responsibleLabels.get(s.responsible) || s.responsible,
        responsibleDisplay:
          responsibleLabels.get(s.responsible) &&
          responsibleLabels.get(s.responsible) !== s.responsible
            ? `${responsibleLabels.get(s.responsible)} (${s.responsible})`
            : s.responsible,
        sector: s.sector,
        unit: s.unit,
        itemCount: s._count.items,
        isFinalized: s.isFinalized,
        isVerified: s.verificationRolls.length > 0,
        startedAt: s.startedAt,
        startedBy: s.startedBy,
        finalizedAt: finalizedEntry?.actedAt || null,
        finalizedBy: finalizedEntry
          ? (actorNames.get(finalizedEntry.actedBy) || finalizedEntry.actedBy)
          : null,
        confirmedAt: confirmedEntry?.actedAt || null,
        confirmedBy: confirmedEntry
          ? (actorNames.get(confirmedEntry.actedBy) || confirmedEntry.actedBy)
          : null,
      };
    });

    res.json(formatted);
  } catch (err) {
    console.error("Error fetching spaces:", err);
    res.status(500).json({ error: "Erro ao carregar espaços" });
  }
});

router.post(
  "/:id/finalize",
  verifyJWT,
  requireInventoryAccess(),
  requireInventoryWriteAccess(),
  requireInventoryOperationalWrite(),
  requireNotRevisor(),
  requireRole("ADMIN", "CONFERENTE"),
  async (req, res) => {
    try {
      const { id } = req.params;
      const result = await prisma.space.updateMany({
        where: { id, inventoryId: req.inventoryId },
        data: { isFinalized: true },
      });
      if (result.count === 0) {
        return res.status(404).json({ error: "Espaço não encontrado" });
      }

      await prisma.finalizationHistory.create({
        data: {
          spaceId: id,
          action: "FINALIZED",
          actedBy: req.user.sub,
        },
      });

      res.json({ success: true, message: "Espaço finalizado" });
    } catch (err) {
      console.error("Error finalizing space:", err);
      res.status(500).json({ error: "Erro ao finalizar espaço" });
    }
  },
);

async function createSpaceHandler(req, res) {
  try {
    const { name, responsible, sector, unit } = req.body;
    const trimmedName = name?.toString().trim();

    if (!trimmedName) {
      return res.status(400).json({ error: "Nome do espaço é obrigatório" });
    }

    const existing = await ensureUniqueSpaceName(trimmedName, req.inventoryId);
    if (existing) {
      return res
        .status(409)
        .json({ error: "Já existe um espaço com esse nome" });
    }

    const space = await prisma.space.create({
      data: {
        name: trimmedName,
        responsible: responsible?.toString().trim() || "Não informado",
        sector: sector?.toString().trim() || null,
        unit: unit?.toString().trim() || null,
        inventoryId: req.inventoryId,
      },
    });

    res.status(201).json({ success: true, space });
  } catch (err) {
    console.error("Error creating space:", err);
    res.status(500).json({ error: "Erro ao criar espaço" });
  }
}

async function updateSpaceHandler(req, res) {
  try {
    const { id } = req.params;
    const { name } = req.body;
    const trimmedName = name?.toString().trim();

    if (!trimmedName) {
      return res.status(400).json({ error: "Nome do espaço é obrigatório" });
    }

    const existing = await ensureUniqueSpaceName(
      trimmedName,
      req.inventoryId,
      id,
    );
    if (existing) {
      return res
        .status(409)
        .json({ error: "Já existe um espaço com esse nome" });
    }

    const result = await prisma.space.updateMany({
      where: { id, inventoryId: req.inventoryId },
      data: { name: trimmedName },
    });

    if (result.count === 0) {
      return res.status(404).json({ error: "Espaço não encontrado" });
    }

    const space = await prisma.space.findUnique({ where: { id } });

    res.json({ success: true, space });
  } catch (err) {
    console.error("Error updating space:", err);
    res.status(500).json({ error: "Erro ao atualizar espaço" });
  }
}

async function deleteSpaceHandler(req, res) {
  try {
    const { id } = req.params;

    const itemCount = await prisma.item.count({
      where: { spaceId: id, inventoryId: req.inventoryId },
    });
    if (itemCount > 0) {
      return res.status(400).json({
        error: "Só é possível desativar um espaço sem itens vinculados",
      });
    }

    const result = await prisma.space.updateMany({
      where: { id, inventoryId: req.inventoryId },
      data: { isActive: false },
    });

    if (result.count === 0) {
      return res.status(404).json({ error: "Espaço não encontrado" });
    }

    const space = await prisma.space.findUnique({ where: { id } });

    res.json({ success: true, space });
  } catch (err) {
    console.error("Error deactivating space:", err);
    res.status(500).json({ error: "Erro ao desativar espaço" });
  }
}

router.post(
  "/admin",
  verifyJWT,
  requireInventoryAccess(),
  requireInventoryWriteAccess(),
  requireInventoryRoles("ADMIN_CICLO", "REVISOR"),
  createSpaceHandler,
);
router.post(
  "/admin/spaces",
  verifyJWT,
  requireInventoryAccess(),
  requireInventoryWriteAccess(),
  requireInventoryRoles("ADMIN_CICLO", "REVISOR"),
  createSpaceHandler,
);
router.get(
  "/admin/spaces",
  verifyJWT,
  requireInventoryAccess(),
  requireRole("ADMIN"),
  async (req, res) => {
    try {
      const spaces = await prisma.space.findMany({
        where: { inventoryId: req.inventoryId },
        include: {
          _count: { select: { items: true } },
          verificationRolls: {
            where: { result: "PASSED" },
            select: { id: true },
            take: 1,
          },
          finalizationHistory: {
            where: { action: { in: ["FINALIZED", "COMPLETED_VERIFICATION"] } },
            orderBy: { actedAt: "desc" },
            select: { action: true, actedBy: true, actedAt: true },
          },
        },
        orderBy: { name: "asc" },
      });

      const responsibleLabels = await buildResponsibleLabels(spaces);
      const allActors = spaces.flatMap((s) =>
        s.finalizationHistory.map((h) => h.actedBy),
      );
      const actorNames = await resolveUserNames(allActors);

      res.json(
        spaces.map((space) => {
          const finalizedEntry = space.finalizationHistory.find(
            (h) => h.action === "FINALIZED",
          );
          const confirmedEntry = space.finalizationHistory.find(
            (h) => h.action === "COMPLETED_VERIFICATION",
          );
          return {
            id: space.id,
            name: space.name,
            responsible: space.responsible,
            responsibleName:
              responsibleLabels.get(space.responsible) || space.responsible,
            responsibleDisplay:
              responsibleLabels.get(space.responsible) &&
              responsibleLabels.get(space.responsible) !== space.responsible
                ? `${responsibleLabels.get(space.responsible)} (${space.responsible})`
                : space.responsible,
            sector: space.sector,
            unit: space.unit,
            isActive: space.isActive,
            isFinalized: space.isFinalized,
            isVerified: space.verificationRolls.length > 0,
            itemCount: space._count.items,
            finalizedAt: finalizedEntry?.actedAt || null,
            finalizedBy: finalizedEntry
              ? (actorNames.get(finalizedEntry.actedBy) || finalizedEntry.actedBy)
              : null,
            confirmedAt: confirmedEntry?.actedAt || null,
            confirmedBy: confirmedEntry
              ? (actorNames.get(confirmedEntry.actedBy) || confirmedEntry.actedBy)
              : null,
          };
        }),
      );
    } catch (err) {
      console.error("Error fetching admin spaces:", err);
      res.status(500).json({ error: "Erro ao carregar espaços" });
    }
  },
);
router.put(
  "/admin/:id",
  verifyJWT,
  requireInventoryAccess(),
  requireInventoryWriteAccess(),
  requireInventoryRoles("ADMIN_CICLO", "REVISOR"),
  updateSpaceHandler,
);
router.put(
  "/admin/spaces/:id",
  verifyJWT,
  requireInventoryAccess(),
  requireInventoryWriteAccess(),
  requireInventoryRoles("ADMIN_CICLO", "REVISOR"),
  updateSpaceHandler,
);
router.delete(
  "/admin/:id",
  verifyJWT,
  requireInventoryAccess(),
  requireInventoryWriteAccess(),
  requireRole("ADMIN"),
  deleteSpaceHandler,
);
router.delete(
  "/admin/spaces/:id",
  verifyJWT,
  requireInventoryAccess(),
  requireInventoryWriteAccess(),
  requireRole("ADMIN"),
  deleteSpaceHandler,
);

// ========================================
// REVISOR VERIFICATION ENDPOINTS
// ========================================

/**
 * POST /api/spaces/:id/initiate-verification
 * When a revisor enters a finalized space, automatically create a verification roll
 * with 10% random sample of items marked for re-verification
 */
router.post(
  "/:id/initiate-verification",
  verifyJWT,
  requireInventoryAccess(),
  requireVerificationAccess(),
  async (req, res) => {
    try {
      const { id } = req.params;

      // Verify space exists and is finalized
      const space = await prisma.space.findUnique({
        where: { id, inventoryId: req.inventoryId },
        include: { items: { select: { id: true } } },
      });

      if (!space) {
        return res.status(404).json({ error: "Espaço não encontrado" });
      }

      if (!space.isFinalized) {
        return res
          .status(400)
          .json({ error: "Espaço não está finalizado" });
      }

      // Check if verification already exists
      const existingRoll = await prisma.verificationRoll.findFirst({
        where: { spaceId: id, result: "PENDING" },
      });

      if (existingRoll) {
        return res.status(400).json({
          error: "Verificação já em andamento para este espaço",
        });
      }

      // Calculate 10% (round up)
      const totalItems = space.items.length;
      const sampleSize = Math.max(1, Math.ceil(totalItems * 0.1));

      // Randomly select items
      const shuffled = space.items.sort(() => 0.5 - Math.random());
      const selectedItems = shuffled.slice(0, sampleSize);
      const selectedItemIds = selectedItems.map((item) => item.id);

      // Update selected items with verification status
      await prisma.item.updateMany({
        where: { id: { in: selectedItemIds } },
        data: { verificationStatus: "REVERIFICAR" },
      });

      // Create verification roll
      const verificationRoll = await prisma.verificationRoll.create({
        data: {
          spaceId: id,
          itemIds: JSON.stringify(selectedItemIds),
          createdBy: req.user.sub,
        },
      });

      res.json({
        success: true,
        verificationRoll,
        selectedItemIds,
        totalToReview: sampleSize,
        totalItems,
      });
    } catch (err) {
      console.error("Error initiating verification:", err);
      res.status(500).json({ error: "Erro ao iniciar verificação" });
    }
  },
);

/**
 * GET /api/spaces/:id/verification-status
 * Get current verification status for a finalized space
 */
router.get(
  "/:id/verification-status",
  verifyJWT,
  requireInventoryAccess(),
  requireVerificationAccess(),
  async (req, res) => {
    try {
      const { id } = req.params;

      const verificationRoll = await prisma.verificationRoll.findFirst({
        where: { spaceId: id, result: "PENDING" },
      });

      if (!verificationRoll) {
        return res.json({ hasActiveVerification: false });
      }

      const selectedItemIds = JSON.parse(verificationRoll.itemIds);
      const items = await prisma.item.findMany({
        where: { id: { in: selectedItemIds } },
        select: {
          id: true,
          patrimonio: true,
          descricao: true,
          statusEncontrado: true,
          verificationStatus: true,
          verifiedAt: true,
          verifiedBy: true,
        },
      });

      const verified = items.filter((i) => i.verificationStatus !== "REVERIFICAR")
        .length;

      res.json({
        hasActiveVerification: true,
        verificationRoll,
        items,
        verified,
        remaining: items.length - verified,
      });
    } catch (err) {
      console.error("Error checking verification status:", err);
      res.status(500).json({ error: "Erro ao verificar status" });
    }
  },
);

/**
 * POST /api/spaces/:id/revert-finalization
 * Revert a finalized space back to INICIADO status
 * Used by revisor when items are not found or manual revert
 */
router.post(
  "/:id/revert-finalization",
  verifyJWT,
  requireInventoryAccess(),
  requireVerificationAccess(),
  async (req, res) => {
    try {
      const { id } = req.params;
      const { reason } = req.body || {};

      // Verify space exists and is finalized
      const space = await prisma.space.findUnique({
        where: { id, inventoryId: req.inventoryId },
      });

      if (!space) {
        return res.status(404).json({ error: "Espaço não encontrado" });
      }

      if (!space.isFinalized) {
        return res.status(400).json({ error: "Espaço já não está finalizado" });
      }

      // Find active verification roll
      const verificationRoll = await prisma.verificationRoll.findFirst({
        where: { spaceId: id, result: "PENDING" },
      });

      // Revert space status
      await prisma.space.update({
        where: { id },
        data: { isFinalized: false },
      });

      // Clear verification status from all items
      await prisma.item.updateMany({
        where: { spaceId: id, verificationStatus: "REVERIFICAR" },
        data: { verificationStatus: null, verifiedAt: null, verifiedBy: null },
      });

      // Mark verification failed and delete roll
      if (verificationRoll) {
        await prisma.verificationRoll.update({
          where: { id: verificationRoll.id },
          data: {
            result: "REVERTED",
            reason: reason || "Revisor reverteu a sala",
            reviewedAt: new Date(),
          },
        });
      }

      // Record finalization history
      await prisma.finalizationHistory.create({
        data: {
          spaceId: id,
          action: reason === "item_not_found" ? "REVERTED_ITEM_NOT_FOUND" : "REVERTED_BY_REVISOR",
          reason: reason || "Manual revert by revisor",
          actedBy: req.user.sub,
        },
      });

      res.json({
        success: true,
        message: "Sala revertida para inspeção dos conferentes",
      });
    } catch (err) {
      console.error("Error reverting finalization:", err);
      res.status(500).json({ error: "Erro ao reverter sala" });
    }
  },
);

/**
 * POST /api/spaces/:id/complete-verification
 * Called by revisor after all sampled items have been checked.
 * Marks the verification roll as PASSED and keeps the room finalized.
 */
router.post(
  "/:id/complete-verification",
  verifyJWT,
  requireInventoryAccess(),
  requireVerificationAccess(),
  async (req, res) => {
    try {
      const { id } = req.params;

      const space = await prisma.space.findUnique({
        where: { id, inventoryId: req.inventoryId },
      });

      if (!space) {
        return res.status(404).json({ error: "Espaço não encontrado" });
      }

      if (!space.isFinalized) {
        return res.status(400).json({ error: "Espaço não está finalizado" });
      }

      const verificationRoll = await prisma.verificationRoll.findFirst({
        where: { spaceId: id, result: "PENDING" },
      });

      if (!verificationRoll) {
        return res
          .status(400)
          .json({ error: "Nenhuma verificação ativa para este espaço" });
      }

      const selectedItemIds = JSON.parse(verificationRoll.itemIds);
      const unresolvedCount = await prisma.item.count({
        where: { id: { in: selectedItemIds }, verificationStatus: "REVERIFICAR" },
      });

      if (unresolvedCount > 0) {
        return res.status(400).json({
          error: `Ainda há ${unresolvedCount} item(ns) pendente(s) de verificação`,
        });
      }

      await prisma.verificationRoll.update({
        where: { id: verificationRoll.id },
        data: { result: "PASSED", reviewedAt: new Date() },
      });

      await prisma.finalizationHistory.create({
        data: {
          spaceId: id,
          action: "COMPLETED_VERIFICATION",
          reason: "Verificação concluída com sucesso pelo revisor",
          actedBy: req.user.sub,
        },
      });

      res.json({
        success: true,
        message: "Sala finalizada com sucesso após verificação.",
      });
    } catch (err) {
      console.error("Error completing verification:", err);
      res.status(500).json({ error: "Erro ao concluir verificação" });
    }
  },
);

export default router;
