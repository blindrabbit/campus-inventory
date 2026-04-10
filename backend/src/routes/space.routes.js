import { Router } from "express";
import { verifyJWT, requireRole } from "../middleware/auth.js";
import {
  requireInventoryAccess,
  requireInventoryOperationalWrite,
  requireInventoryWriteAccess,
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
      },
      orderBy: { name: "asc" },
      take: q ? 10 : undefined,
    });

    const responsibleLabels = await buildResponsibleLabels(spaces);

    const formatted = spaces.map((s) => ({
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
      startedAt: s.startedAt,
      startedBy: s.startedBy,
    }));

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
  requireRole("ADMIN"),
  createSpaceHandler,
);
router.post(
  "/admin/spaces",
  verifyJWT,
  requireInventoryAccess(),
  requireInventoryWriteAccess(),
  requireRole("ADMIN"),
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
        include: { _count: { select: { items: true } } },
        orderBy: { name: "asc" },
      });

      const responsibleLabels = await buildResponsibleLabels(spaces);

      res.json(
        spaces.map((space) => ({
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
          itemCount: space._count.items,
        })),
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
  requireRole("ADMIN"),
  updateSpaceHandler,
);
router.put(
  "/admin/spaces/:id",
  verifyJWT,
  requireInventoryAccess(),
  requireInventoryWriteAccess(),
  requireRole("ADMIN"),
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

export default router;
