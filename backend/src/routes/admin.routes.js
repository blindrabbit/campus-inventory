import { Router } from "express";
import { verifyJWT } from "../middleware/auth.js";
import { prisma } from "../prisma/client.js";

const router = Router();

const INVENTORY_ROLES = [
  "ADMIN_CICLO",
  "CONFERENTE",
  "REVISOR",
  "VISUALIZADOR",
];

const isValidInventoryRole = (role) => INVENTORY_ROLES.includes(role);

const requireUserManagementAccess = async (req, res, next) => {
  try {
    const samAccountName = req.user?.sub;
    if (!samAccountName) {
      return res.status(401).json({ error: "Usuário não autenticado" });
    }

    const actor = await prisma.user.findUnique({
      where: { samAccountName },
      select: { id: true, role: true },
    });

    if (!actor) {
      return res.status(401).json({ error: "Usuário não encontrado" });
    }

    if (actor.role === "ADMIN") {
      req.actorUser = actor;
      return next();
    }

    const cycleAdminAccess = await prisma.inventoryUser.findFirst({
      where: {
        userId: actor.id,
        role: "ADMIN_CICLO",
      },
      select: { id: true },
    });

    if (!cycleAdminAccess) {
      return res.status(403).json({ error: "Acesso negado" });
    }

    req.actorUser = actor;
    return next();
  } catch (error) {
    console.error("Error validating global user management access:", error);
    return res.status(500).json({ error: "Erro ao validar acesso" });
  }
};

router.use(verifyJWT, requireUserManagementAccess);

router.get("/users", async (req, res) => {
  try {
    const search = req.query.search?.toString().trim();

    const users = await prisma.user.findMany({
      where: search
        ? {
            OR: [
              { samAccountName: { contains: search } },
              { fullName: { contains: search } },
            ],
          }
        : undefined,
      include: {
        inventoryLinks: {
          include: {
            inventory: {
              select: {
                id: true,
                name: true,
                statusOperacao: true,
              },
            },
          },
          orderBy: {
            inventory: {
              name: "asc",
            },
          },
        },
      },
      orderBy: [{ fullName: "asc" }, { samAccountName: "asc" }],
      take: 200,
    });

    return res.json(
      users.map((user) => ({
        userId: user.id,
        samAccountName: user.samAccountName,
        fullName: user.fullName,
        globalRole: user.role,
        inventories: user.inventoryLinks.map((link) => ({
          inventoryId: link.inventory.id,
          inventoryName: link.inventory.name,
          role: link.role,
          statusOperacao: link.inventory.statusOperacao,
        })),
      })),
    );
  } catch (error) {
    console.error("Error listing global users:", error);
    return res.status(500).json({ error: "Erro ao listar usuários" });
  }
});

router.post("/users/:userId/inventories", async (req, res) => {
  try {
    const { userId } = req.params;
    const inventoryId = req.body?.inventoryId?.toString().trim();
    const role = req.body?.role?.toString().trim();

    if (!userId || !inventoryId || !role) {
      return res
        .status(400)
        .json({ error: "userId, inventoryId e role são obrigatórios" });
    }

    if (!isValidInventoryRole(role)) {
      return res.status(400).json({ error: "Perfil de inventário inválido" });
    }

    const [user, inventory] = await Promise.all([
      prisma.user.findUnique({ where: { id: userId }, select: { id: true } }),
      prisma.inventory.findUnique({
        where: { id: inventoryId },
        select: { id: true, name: true },
      }),
    ]);

    if (!user) {
      return res.status(404).json({ error: "Usuário não encontrado" });
    }

    if (!inventory) {
      return res.status(404).json({ error: "Inventário não encontrado" });
    }

    const link = await prisma.inventoryUser.upsert({
      where: {
        inventoryId_userId: {
          inventoryId,
          userId,
        },
      },
      create: {
        inventoryId,
        userId,
        role,
      },
      update: {
        role,
      },
    });

    return res.json({
      userId,
      inventoryId,
      inventoryName: inventory.name,
      role: link.role,
    });
  } catch (error) {
    console.error("Error adding user to inventory:", error);
    return res.status(500).json({ error: "Erro ao adicionar vínculo" });
  }
});

router.patch("/users/:userId/inventories/:inventoryId", async (req, res) => {
  try {
    const { userId, inventoryId } = req.params;
    const role = req.body?.role?.toString().trim();

    if (!role) {
      return res.status(400).json({ error: "role é obrigatório" });
    }

    if (!isValidInventoryRole(role)) {
      return res.status(400).json({ error: "Perfil de inventário inválido" });
    }

    const link = await prisma.inventoryUser.update({
      where: {
        inventoryId_userId: {
          inventoryId,
          userId,
        },
      },
      data: {
        role,
      },
    });

    return res.json({
      userId,
      inventoryId,
      role: link.role,
    });
  } catch (error) {
    if (error?.code === "P2025") {
      return res.status(404).json({ error: "Vínculo não encontrado" });
    }
    console.error("Error updating user inventory role:", error);
    return res.status(500).json({ error: "Erro ao atualizar vínculo" });
  }
});

router.delete("/users/:userId/inventories/:inventoryId", async (req, res) => {
  try {
    const { userId, inventoryId } = req.params;

    await prisma.inventoryUser.delete({
      where: {
        inventoryId_userId: {
          inventoryId,
          userId,
        },
      },
    });

    return res.json({ success: true });
  } catch (error) {
    if (error?.code === "P2025") {
      return res.status(404).json({ error: "Vínculo não encontrado" });
    }
    console.error("Error removing user from inventory:", error);
    return res.status(500).json({ error: "Erro ao remover vínculo" });
  }
});

export default router;
