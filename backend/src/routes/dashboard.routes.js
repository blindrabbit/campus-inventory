import { Router } from "express";
import { verifyJWT } from "../middleware/auth.js";
import { requireInventoryAccess } from "../middleware/inventory.js";
import { prisma } from "../prisma/client.js";
import { getInventoryCounters } from "../services/metrics.js";

const router = Router();

router.get(
  "/summary",
  verifyJWT,
  requireInventoryAccess(),
  async (req, res) => {
    try {
      const inventoryId = req.inventoryId;

      const inventory = await prisma.inventory.findUnique({
        where: { id: inventoryId },
        select: { id: true, createdById: true },
      });

      const requestUser = req.requestUser || null;
      const allowed =
        req.inventoryRole === "ADMIN_CICLO" ||
        requestUser?.role === "ADMIN" ||
        (inventory && requestUser && inventory.createdById === requestUser.id);

      if (!allowed) {
        return res.status(403).json({ error: "Acesso negado ao dashboard" });
      }

      const counters = await getInventoryCounters(inventoryId);

      const now = Date.now();
      const oneHourAgo = new Date(now - 60 * 60 * 1000);
      const twentyFourHoursAgo = new Date(now - 24 * 60 * 60 * 1000);
      const sevenDaysAgo = new Date(now - 7 * 24 * 60 * 60 * 1000);

      let totalItems = 0;
      let foundCount = 0;
      let unfoundCount = 0;
      let pendingCount = 0;
      let relocatedPending = 0;
      let spacesCount = 0;
      let spacesStarted = 0;
      let spacesFinalized = 0;
      let itemsLastHour = 0;
      let lowCoverage = [];

      if (counters) {
        totalItems = Number(counters.total_items || 0);
        foundCount = Number(counters.checked_count || 0);
        unfoundCount = Number(counters.unfound_count || 0);
        pendingCount = Number(counters.pending_count || 0);
        relocatedPending = Number(counters.relocated_pending || 0);

        const rows = await prisma.$queryRaw`
          SELECT sc.spaceId, sc.total_items, sc.checked_count, s.name
          FROM space_counters sc
          LEFT JOIN spaces s ON s.id = sc.spaceId
          WHERE sc.inventoryId = ${inventoryId}
          ORDER BY (CASE WHEN sc.total_items = 0 THEN 1 ELSE (CAST(sc.checked_count AS FLOAT)/sc.total_items) END) ASC
          LIMIT 50
        `;

        const spaceCoverages = (rows || []).map((r) => {
          const total = Number(r.total_items || 0);
          const checked = Number(r.checked_count || 0);
          const coverage = total === 0 ? 1 : checked / total;
          return { id: r.spaceId, name: r.name || "-", total, checked, coverage };
        });

        lowCoverage = spaceCoverages.filter((s) => s.total > 0).slice(0, 10);

        spacesCount = await prisma.space.count({ where: { inventoryId } });
        spacesStarted = await prisma.space.count({ where: { inventoryId, startedAt: { not: null } } });
        spacesFinalized = await prisma.space.count({ where: { inventoryId, isFinalized: true } });
        itemsLastHour = await prisma.item.count({ where: { inventoryId, dataConferencia: { gte: oneHourAgo } } });
      } else {
        const [
          tItems, fCount, uCount, pCount, rPending,
          sCount, sStarted, sFinal, iLastHour,
        ] = await Promise.all([
          prisma.item.count({ where: { inventoryId } }),
          prisma.item.count({ where: { inventoryId, statusEncontrado: "SIM" } }),
          prisma.item.count({ where: { inventoryId, statusEncontrado: "NAO" } }),
          prisma.item.count({ where: { inventoryId, statusEncontrado: "PENDENTE" } }),
          prisma.relocation.count({ where: { pendingConfirm: true, item: { inventoryId } } }),
          prisma.space.count({ where: { inventoryId } }),
          prisma.space.count({ where: { inventoryId, startedAt: { not: null } } }),
          prisma.space.count({ where: { inventoryId, isFinalized: true } }),
          prisma.item.count({ where: { inventoryId, dataConferencia: { gte: oneHourAgo } } }),
        ]);

        totalItems = tItems;
        foundCount = fCount;
        unfoundCount = uCount;
        pendingCount = pCount;
        relocatedPending = rPending;
        spacesCount = sCount;
        spacesStarted = sStarted;
        spacesFinalized = sFinal;
        itemsLastHour = iLastHour;

        const spaces = await prisma.space.findMany({
          where: { inventoryId },
          select: { id: true, name: true },
          take: 50,
        });

        const spaceCoveragePromises = spaces.map(async (s) => {
          const [total, checked] = await Promise.all([
            prisma.item.count({ where: { inventoryId, spaceId: s.id } }),
            prisma.item.count({ where: { inventoryId, spaceId: s.id, statusEncontrado: "SIM" } }),
          ]);
          const coverage = total === 0 ? 1 : checked / total;
          return { id: s.id, name: s.name, total, checked, coverage };
        });

        const spaceCoverages = await Promise.all(spaceCoveragePromises);
        lowCoverage = spaceCoverages.filter((s) => s.total > 0).sort((a, b) => a.coverage - b.coverage).slice(0, 10);
      }

      // --- New metrics (run in parallel) ---
      const [
        spacesVerifiedByRevisor,
        itemsLast24h,
        itemsLast7d,
        verificationPending,
      ] = await Promise.all([
        prisma.space.count({ where: { inventoryId, isVerifiedByRevisor: true } }),
        prisma.item.count({ where: { inventoryId, dataConferencia: { gte: twentyFourHoursAgo } } }),
        prisma.item.count({ where: { inventoryId, dataConferencia: { gte: sevenDaysAgo } } }),
        prisma.item.count({ where: { inventoryId, verificationStatus: "REVERIFICAR" } }),
      ]);

      // Coverage distribution buckets (from space_counters if available, otherwise approximate)
      let coverageDistribution = { zero: 0, low: 0, medium: 0, complete: 0 };
      try {
        const distRows = await prisma.$queryRaw`
          SELECT
            SUM(CASE WHEN total_items = 0 OR checked_count = 0 THEN 1 ELSE 0 END) as zero_count,
            SUM(CASE WHEN total_items > 0 AND checked_count > 0 AND CAST(checked_count AS FLOAT)/total_items < 0.5 THEN 1 ELSE 0 END) as low_count,
            SUM(CASE WHEN total_items > 0 AND CAST(checked_count AS FLOAT)/total_items >= 0.5 AND checked_count < total_items THEN 1 ELSE 0 END) as medium_count,
            SUM(CASE WHEN total_items > 0 AND checked_count >= total_items THEN 1 ELSE 0 END) as complete_count
          FROM space_counters
          WHERE inventoryId = ${inventoryId}
        `;
        if (distRows && distRows[0]) {
          coverageDistribution = {
            zero: Number(distRows[0].zero_count || 0),
            low: Number(distRows[0].low_count || 0),
            medium: Number(distRows[0].medium_count || 0),
            complete: Number(distRows[0].complete_count || 0),
          };
        }
      } catch (_) {
        // space_counters might not exist; leave zeros
      }

      // Pace & projection
      const dailyPace = itemsLast7d / 7;
      const remainingItems = pendingCount;
      const estimatedDays = dailyPace > 0 && remainingItems > 0
        ? Math.ceil(remainingItems / dailyPace)
        : remainingItems === 0 ? 0 : null;

      // Execution funnel derived values
      const spacesInProgress = spacesStarted - spacesFinalized;
      const spacesFinalizedOnly = spacesFinalized - spacesVerifiedByRevisor;
      const spacesNotStarted = spacesCount - spacesStarted;

      const summary = {
        inventoryId,
        totalItems,
        foundCount,
        unfoundCount,
        pendingCount,
        relocatedPending,
        spacesCount,
        spacesStarted,
        spacesFinalized,
        spacesVerifiedByRevisor,
        spacesInProgress,
        spacesFinalizedOnly,
        spacesNotStarted,
        itemsLastHour,
        itemsLast24h,
        itemsLast7d,
        verificationPending,
        coverageDistribution,
        dailyPace: Math.round(dailyPace * 10) / 10,
        estimatedDays,
        coveragePercent: totalItems === 0 ? 1 : foundCount / totalItems,
        lowCoverageSpaces: lowCoverage,
        timestamp: new Date(),
      };

      return res.json(summary);
    } catch (err) {
      console.error("Error building dashboard summary:", err);
      return res.status(500).json({ error: "Erro ao montar resumo do dashboard" });
    }
  },
);

export default router;
