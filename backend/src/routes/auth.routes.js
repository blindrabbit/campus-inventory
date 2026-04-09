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

    const normalizedSam = loginSam;

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

    const user = await prisma.user.upsert({
      where: { samAccountName: normalizedSam },
      update: {
        fullName: shouldUpdateFullName ? resolvedFullName : undefined,
        role: isNativeAdmin ? "ADMIN" : undefined,
      },
      create: {
        samAccountName: normalizedSam,
        fullName: resolvedFullName || normalizedSam,
        role: isNativeAdmin ? "ADMIN" : "CONFERENTE",
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

export default router;
