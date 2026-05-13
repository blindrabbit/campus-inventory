import { Router } from "express";
import { verifyJWT } from "../middleware/auth.js";
import { requireInventoryAccess } from "../middleware/inventory.js";
import { prisma } from "../prisma/client.js";

const router = Router();

const MAX_LOOKBACK_DAYS = 7;

/**
 * GET /api/users/me/session-summary
 * Retorna um resumo das ações do usuário desde a sessão anterior.
 * Query params: inventoryId (via middleware), since (ISO date)
 */
router.get(
  "/me/session-summary",
  verifyJWT,
  requireInventoryAccess(),
  async (req, res) => {
    try {
      const { since } = req.query;
      const userId = req.user.sub; // samAccountName
      const inventoryId = req.inventoryId;

      if (!since) {
        return res.status(400).json({ error: "Parâmetro 'since' é obrigatório" });
      }

      const sinceDate = new Date(since);
      if (isNaN(sinceDate.getTime())) {
        return res.status(400).json({ error: "Parâmetro 'since' inválido" });
      }

      // Limita o lookback para evitar consultas pesadas
      const minAllowed = new Date();
      minAllowed.setDate(minAllowed.getDate() - MAX_LOOKBACK_DAYS);
      const effectiveSince = sinceDate < minAllowed ? minAllowed : sinceDate;

      // Busca todas as ações do usuário no período, filtrando pelo inventário via join
      const history = await prisma.itemHistorico.findMany({
        where: {
          createdBy: userId,
          createdAt: { gte: effectiveSince },
          item: { inventoryId },
        },
        select: {
          action: true,
          createdAt: true,
          item: {
            select: {
              spaceId: true,
              space: { select: { id: true, name: true } },
            },
          },
        },
        orderBy: { createdAt: "desc" },
      });

      if (history.length === 0) {
        return res.json({ totalActions: 0, spaceSummary: [], lastVisitedSpaceId: null, lastVisitedSpaceName: null });
      }

      // Agrupa por espaço
      const spaceMap = new Map();
      for (const entry of history) {
        const space = entry.item?.space;
        if (!space) continue;

        if (!spaceMap.has(space.id)) {
          spaceMap.set(space.id, {
            spaceId: space.id,
            spaceName: space.name,
            lastActionAt: entry.createdAt,
            actions: {},
          });
        }

        const bucket = spaceMap.get(space.id);
        bucket.actions[entry.action] = (bucket.actions[entry.action] || 0) + 1;
        // createdAt DESC então o primeiro encontrado é o mais recente
        if (entry.createdAt > bucket.lastActionAt) {
          bucket.lastActionAt = entry.createdAt;
        }
      }

      const spaceSummary = [...spaceMap.values()].sort(
        (a, b) => new Date(b.lastActionAt) - new Date(a.lastActionAt),
      );

      // Busca o lastVisitedSpaceId do InventoryUser para "retomar"
      const invUser = await prisma.inventoryUser.findUnique({
        where: { inventoryId_userId: { inventoryId, userId: req.requestUser.id } },
        select: { lastVisitedSpaceId: true },
      });

      const lastVisitedSpaceId = invUser?.lastVisitedSpaceId
        ?? spaceSummary[0]?.spaceId
        ?? null;

      const lastVisitedSpaceName =
        spaceSummary.find((s) => s.spaceId === lastVisitedSpaceId)?.spaceName ?? null;

      return res.json({
        totalActions: history.length,
        spaceSummary,
        lastVisitedSpaceId,
        lastVisitedSpaceName,
      });
    } catch (err) {
      console.error("Error fetching session summary:", err);
      res.status(500).json({ error: "Erro ao buscar resumo da sessão" });
    }
  },
);

/**
 * PATCH /api/users/me/last-visited
 * Registra a última sala visitada pelo usuário num inventário.
 * Body: { inventoryId, spaceId }
 */
router.patch(
  "/me/last-visited",
  verifyJWT,
  requireInventoryAccess(),
  async (req, res) => {
    try {
      const { spaceId } = req.body;
      const inventoryId = req.inventoryId;

      if (!spaceId) {
        return res.status(400).json({ error: "spaceId é obrigatório" });
      }

      await prisma.inventoryUser.updateMany({
        where: {
          inventoryId,
          userId: req.requestUser.id,
        },
        data: { lastVisitedSpaceId: spaceId },
      });

      res.json({ ok: true });
    } catch (err) {
      console.error("Error updating last visited space:", err);
      res.status(500).json({ error: "Erro ao atualizar última sala visitada" });
    }
  },
);

export default router;
