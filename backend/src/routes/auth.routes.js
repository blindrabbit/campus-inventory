import { Router } from "express";
import jwt from "jsonwebtoken";
import rateLimit from "express-rate-limit";
import {
  isDirectoryUserNativeAdmin,
  resolveUserCn,
  validateUser,
} from "../services/ldap.js";
import { prisma } from "../prisma/client.js";
import { ensureInventoryBootstrapForUser } from "../services/inventory.js";

const router = Router();

const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: Number(process.env.LOGIN_RATE_LIMIT_MAX || 20),
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Muitas tentativas de login. Tente novamente mais tarde." },
});

router.post("/login", loginLimiter, async (req, res) => {
  try {
    const { sAMAccountName, password } = req.body;
    const loginSam = sAMAccountName?.toString().trim();

    if (!loginSam || !password) {
      return res
        .status(400)
        .json({ error: "Usuário e senha são obrigatórios" });
    }

    const userData = await validateUser(loginSam, password);
    if (!userData) {
      return res.status(401).json({ error: "Credenciais inválidas" });
    }

    const normalizedSam = loginSam.toLowerCase();

    let resolvedFullName = userData.fullName?.toString().trim() || null;

    // Se o LDAP devolveu apenas o próprio login, tenta buscar CN explicitamente.
    if (
      !resolvedFullName ||
      resolvedFullName.toLowerCase() === normalizedSam.toLowerCase()
    ) {
      const cn = await resolveUserCn(normalizedSam);
      if (cn?.toString().trim()) {
        resolvedFullName = cn.toString().trim();
      }
    }

    const shouldUpdateFullName =
      Boolean(resolvedFullName) &&
      resolvedFullName.toLowerCase() !== normalizedSam.toLowerCase();

    let isNativeAdmin = false;
    try {
      isNativeAdmin = await isDirectoryUserNativeAdmin(normalizedSam);
    } catch (membershipError) {
      console.error("Native admin membership check failed:", membershipError);
    }

    // Lê o lastSessionAt ANTES do upsert para devolver como previousSessionAt
    const existingUser = await prisma.user.findUnique({
      where: { samAccountName: normalizedSam },
      select: { lastSessionAt: true },
    });
    const previousSessionAt = existingUser?.lastSessionAt ?? null;

    const now = new Date();
    const user = await prisma.user.upsert({
      where: { samAccountName: normalizedSam },
      update: {
        fullName: shouldUpdateFullName ? resolvedFullName : undefined,
        role: isNativeAdmin ? "ADMIN" : undefined,
        lastSessionAt: now,
      },
      create: {
        samAccountName: normalizedSam,
        fullName: resolvedFullName || normalizedSam,
        role: isNativeAdmin ? "ADMIN" : "CONFERENTE",
        lastSessionAt: now,
      },
    });

    const token = jwt.sign(
      { sub: user.samAccountName, role: user.role, fullName: user.fullName },
      process.env.JWT_SECRET,
      { expiresIn: "8h" },
    );

    const defaultInventory = await ensureInventoryBootstrapForUser(user);

    res.json({
      token,
      user: {
        samAccountName: user.samAccountName,
        fullName: user.fullName,
        role: user.role,
      },
      activeInventory: {
        id: defaultInventory.id,
        name: defaultInventory.name,
      },
      previousSessionAt,
    });
  } catch (err) {
    console.error("Login error:", err);
    if (err?.message === "Falha na autenticação LDAP") {
      return res
        .status(503)
        .json({ error: "Serviço de autenticação indisponível" });
    }
    res.status(500).json({ error: "Erro interno no servidor" });
  }
});

/**
 * GET /auth/inventory-role
 * Returns the current user's role for a specific inventory
 */
router.get("/inventory-role", async (req, res) => {
  try {
    const token = req.headers.authorization?.split(" ")[1];
    if (!token) {
      return res.status(401).json({ error: "Token não fornecido" });
    }

    const decoded = jwt.verify(token, process.env.JWT_SECRET || "dev-secret");
    const inventoryId = req.query.inventoryId?.toString();

    if (!inventoryId) {
      return res.status(400).json({ error: "inventoryId é obrigatório" });
    }

    // Resolve the DB user first (decoded.sub is samAccountName, not the DB id)
    const user = await prisma.user.findUnique({
      where: { samAccountName: decoded.sub },
      select: { id: true, role: true },
    });

    const inventory = await prisma.inventory.findUnique({
      where: { id: inventoryId },
      select: { statusOperacao: true },
    });
    const statusOperacao = inventory?.statusOperacao || null;

    // Global admins always get ADMIN_CICLO
    if (user?.role === "ADMIN") {
      return res.json({ inventoryRole: "ADMIN_CICLO", inventoryId, statusOperacao });
    }

    // Look up inventory-specific role using the real DB id
    let role = null;
    if (user) {
      const inventoryUser = await prisma.inventoryUser.findUnique({
        where: {
          inventoryId_userId: {
            inventoryId,
            userId: user.id,
          },
        },
        select: { role: true },
      });
      role = inventoryUser?.role || null;
    }

    res.json({
      inventoryRole: role || "CONFERENTE",
      inventoryId,
      statusOperacao,
    });
  } catch (err) {
    console.error("Error getting inventory role:", err);
    res.status(500).json({ error: "Erro ao obter perfil do inventário" });
  }
});

export default router;
