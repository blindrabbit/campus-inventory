import {
  ensureInventoryBootstrapForUser,
  findUserBySamAccountName,
  resolveInventoryAccess,
} from "../services/inventory.js";
import { prisma } from "../prisma/client.js";

function extractInventoryId(req) {
  return (
    req.query.inventoryId?.toString() ||
    req.body?.inventoryId?.toString() ||
    req.params.inventoryId?.toString() ||
    req.headers["x-inventory-id"]?.toString() ||
    null
  );
}

export const requireInventoryAccess = () => {
  return async (req, res, next) => {
    try {
      const inventoryId = extractInventoryId(req);
      if (!inventoryId) {
        return res.status(400).json({ error: "inventoryId é obrigatório" });
      }

      const user = await findUserBySamAccountName(req.user?.sub);

      if (!user) {
        return res.status(401).json({ error: "Usuário não encontrado" });
      }

      await ensureInventoryBootstrapForUser(user);

      const inventory = await prisma.inventory.findUnique({
        where: { id: inventoryId },
        select: {
          id: true,
          name: true,
          statusOperacao: true,
        },
      });

      if (!inventory) {
        return res.status(404).json({ error: "Inventário não encontrado" });
      }

      const { access } = await resolveInventoryAccess({
        inventoryId,
        samAccountName: req.user?.sub,
      });

      if (!access) {
        return res.status(403).json({ error: "Acesso negado ao inventário" });
      }

      req.inventoryId = inventoryId;
      req.inventoryRole = access.role;
      req.requestUser = user;
      req.inventory = inventory;
      return next();
    } catch (error) {
      console.error("Inventory access middleware error:", error);
      return res.status(500).json({ error: "Erro ao validar inventário" });
    }
  };
};

export const requireInventoryOperationalWrite = () => {
  return (req, res, next) => {
    const status = req.inventory?.statusOperacao;
    if (!status) {
      return res
        .status(500)
        .json({ error: "Status do inventário não resolvido" });
    }

    if (status === "PAUSADO") {
      return res.status(409).json({
        error: "Inventário pausado: operações de conferência estão bloqueadas",
      });
    }

    if (status === "EM_AUDITORIA") {
      return res.status(409).json({
        error: "Inventário em auditoria: novas conferências estão bloqueadas",
      });
    }

    if (status === "FINALIZADO" || status === "CANCELADO") {
      return res.status(409).json({
        error: `Inventário ${status.toLowerCase()}: operação não permitida`,
      });
    }

    return next();
  };
};

export const requireInventoryRoles = (...allowedRoles) => {
  return (req, res, next) => {
    if (!req.inventoryRole) {
      return res
        .status(500)
        .json({ error: "Perfil do inventário não resolvido" });
    }

    if (!allowedRoles.includes(req.inventoryRole)) {
      return res.status(403).json({ error: "Perfil sem permissão nesta ação" });
    }

    return next();
  };
};

export const requireInventoryWriteAccess = () => {
  return (req, res, next) => {
    if (!req.inventoryRole) {
      return res
        .status(500)
        .json({ error: "Perfil do inventário não resolvido" });
    }

    if (req.inventoryRole === "VISUALIZADOR") {
      return res
        .status(403)
        .json({ error: "Perfil VISUALIZADOR não pode alterar dados" });
    }

    return next();
  };
};
