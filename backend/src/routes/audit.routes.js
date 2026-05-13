import { Router } from "express";
import { verifyJWT, requireRole } from "../middleware/auth.js";
import { requireInventoryAccess, requireInventoryRoles } from "../middleware/inventory.js";
import { prisma } from "../prisma/client.js";
import { queryEventLog, getEventLogInsights } from "../services/event-log.js";

const router = Router();

function formatHistoryEntry(entry, nameMap = {}) {
  return {
    id: entry.id,
    action: entry.action,
    reason: entry.reason,
    createdBy: nameMap[entry.createdBy] || entry.createdBy,
    createdAt: entry.createdAt,
    metadata: entry.metadata,
    fromSpaceId: entry.fromSpaceId,
    toSpaceId: entry.toSpaceId,
    fromSpaceName: entry.fromSpace?.name || null,
    toSpaceName: entry.toSpace?.name || null,
  };
}

async function buildNameMap(samAccountNames) {
  const unique = [...new Set(samAccountNames.filter(Boolean))];
  if (unique.length === 0) return {};
  const users = await prisma.user.findMany({
    where: { samAccountName: { in: unique } },
    select: { samAccountName: true, fullName: true },
  });
  return Object.fromEntries(users.map((u) => [u.samAccountName, u.fullName]));
}

router.get(
  "/unfound-items",
  verifyJWT,
  requireInventoryAccess(),
  requireRole("ADMIN"),
  async (req, res) => {
    try {
      const { fromSpaceId, conferente, action, fromDate, toDate } = req.query;
      const page = Math.max(Number(req.query.page || 1), 1);
      const limit = Math.min(Math.max(Number(req.query.limit || 20), 1), 100);

      const items = await prisma.item.findMany({
        where: {
          inventoryId: req.inventoryId,
          OR: [
            { statusEncontrado: "NAO" },
            { relocationIn: { is: { pendingConfirm: true } } },
          ],
        },
        include: {
          space: {
            select: { id: true, name: true, responsible: true },
          },
          relocationIn: {
            select: {
              pendingConfirm: true,
            },
          },
          history: {
            include: {
              fromSpace: { select: { id: true, name: true } },
              toSpace: { select: { id: true, name: true } },
            },
            orderBy: { createdAt: "desc" },
          },
        },
        orderBy: { updatedAt: "desc" },
      });

      const filtered = items.filter((item) => {
        const latestHistory = item.history[0];
        const latestAction = latestHistory?.action;
        const latestConferente =
          item.ultimoConferente || latestHistory?.createdBy || "";
        const latestDate =
          item.dataConferencia || latestHistory?.createdAt || item.updatedAt;
        const originSpaceId = item.lastKnownSpaceId || item.spaceId;

        if (fromSpaceId && originSpaceId !== fromSpaceId) return false;
        if (
          conferente &&
          !latestConferente
            .toLowerCase()
            .includes(conferente.toString().toLowerCase())
        )
          return false;
        if (action && latestAction !== action) return false;
        if (fromDate && latestDate < new Date(fromDate)) return false;
        if (toDate) {
          const end = new Date(toDate);
          end.setHours(23, 59, 59, 999);
          if (latestDate > end) return false;
        }

        return true;
      });

      const total = filtered.length;
      const start = (page - 1) * limit;
      const paginatedItems = filtered.slice(start, start + limit);

      // Resolve samAccountNames → fullName in a single query
      const allSamAccounts = paginatedItems.flatMap((item) => [
        item.ultimoConferente,
        ...item.history.map((h) => h.createdBy),
      ]);
      const nameMap = await buildNameMap(allSamAccounts);

      res.json({
        items: paginatedItems.map((item) => {
          const latestHistory = item.history[0];
          const isPendingMove = item.relocationIn?.pendingConfirm === true;
          const statusAtual = isPendingMove
            ? "MOVIDO_PENDENTE_ACEITE"
            : item.statusEncontrado === "NAO"
              ? "NAO_ENCONTRADO"
              : item.statusEncontrado;

          const conferenteSam = item.ultimoConferente || latestHistory?.createdBy || null;

          return {
            id: item.id,
            patrimonio: item.patrimonio,
            descricao: item.descricao,
            statusAtual,
            dataUltimaAlteracao:
              item.dataConferencia ||
              latestHistory?.createdAt ||
              item.updatedAt,
            ultimoResponsavel: nameMap[conferenteSam] || conferenteSam || null,
            ultimoLocalConhecido: item.space?.name || null,
            ultimoLocalConhecidoId: item.spaceId,
            conferente: nameMap[conferenteSam] || conferenteSam || null,
            historicoLocalizacoes: item.history.map((h) => formatHistoryEntry(h, nameMap)),
          };
        }),
        pagination: {
          page,
          limit,
          total,
          totalPages: Math.max(Math.ceil(total / limit), 1),
        },
      });
    } catch (err) {
      console.error("Error loading unfound audit items:", err);
      res.status(500).json({ error: "Erro ao carregar auditoria" });
    }
  },
);

router.get(
  "/space-movements",
  verifyJWT,
  requireInventoryAccess(),
  async (req, res) => {
    try {
      const { spaceId } = req.query;
      if (!spaceId) {
        return res.status(400).json({ error: "spaceId é obrigatório" });
      }

      const page = Math.max(Number(req.query.page || 1), 1);
      const limit = Math.min(Math.max(Number(req.query.limit || 20), 1), 100);

      const space = await prisma.space.findFirst({
        where: { id: spaceId, inventoryId: req.inventoryId },
        select: { id: true },
      });

      if (!space) {
        return res.status(404).json({ error: "Espaço não encontrado" });
      }

      const where = {
        item: { inventoryId: req.inventoryId },
        OR: [{ fromSpaceId: spaceId }, { toSpaceId: spaceId }],
      };

      const [total, history] = await Promise.all([
        prisma.itemHistorico.count({ where }),
        prisma.itemHistorico.findMany({
          where,
          include: {
            item: {
              select: {
                id: true,
                patrimonio: true,
                descricao: true,
              },
            },
            fromSpace: { select: { id: true, name: true } },
            toSpace: { select: { id: true, name: true } },
          },
          orderBy: { createdAt: "desc" },
          skip: (page - 1) * limit,
          take: limit,
        }),
      ]);

      const items = history.map((entry) => {
        const isEntry =
          entry.toSpaceId === spaceId && entry.fromSpaceId !== spaceId;
        const isExit =
          entry.fromSpaceId === spaceId && entry.toSpaceId !== spaceId;

        return {
          id: entry.id,
          itemId: entry.itemId,
          patrimonio: entry.item?.patrimonio || "-",
          descricao: entry.item?.descricao || "-",
          action: entry.action,
          direction: isEntry ? "ENTRADA" : isExit ? "SAIDA" : "INTERNO",
          fromSpaceName: entry.fromSpace?.name || null,
          toSpaceName: entry.toSpace?.name || null,
          createdBy: entry.createdBy,
          createdAt: entry.createdAt,
          reason: entry.reason,
        };
      });

      res.json({
        items,
        pagination: {
          page,
          limit,
          total,
          totalPages: Math.max(Math.ceil(total / limit), 1),
        },
      });
    } catch (err) {
      console.error("Error loading room movement history:", err);
      res.status(500).json({ error: "Erro ao carregar histórico da sala" });
    }
  },
);

router.get(
  "/items/:itemId/history",
  verifyJWT,
  requireInventoryAccess(),
  requireInventoryRoles("ADMIN_CICLO"),
  async (req, res) => {
    try {
      const { itemId } = req.params;

      const item = await prisma.item.findUnique({
        where: { id: itemId },
        include: {
          space: { select: { id: true, name: true } },
          history: {
            include: {
              fromSpace: { select: { id: true, name: true } },
              toSpace: { select: { id: true, name: true } },
            },
            orderBy: { createdAt: "asc" },
          },
        },
      });

      if (!item) {
        return res.status(404).json({ error: "Item não encontrado" });
      }

      if (item.inventoryId !== req.inventoryId) {
        return res.status(403).json({ error: "Acesso negado ao inventário" });
      }

      // Resolve full names for all actors in history
      const actors = [...new Set(item.history.map((h) => h.createdBy).filter(Boolean))];
      const nameMap = await buildNameMap(actors);

      res.json({
        item: {
          id: item.id,
          patrimonio: item.patrimonio,
          descricao: item.descricao,
          valor: item.valor,
          condicaoOriginal: item.condicaoOriginal,
          condicaoVisual: item.condicaoVisual,
          statusEncontrado: item.statusEncontrado,
          codigoSIA: item.codigoSIA,
          fornecedor: item.fornecedor,
          dataAquisicao: item.dataAquisicao,
          documento: item.documento,
          tipoAquisicao: item.tipoAquisicao,
          currentSpace: item.space ? { id: item.space.id, name: item.space.name } : null,
        },
        history: item.history.map((h) => formatHistoryEntry(h, nameMap)),
      });
    } catch (err) {
      console.error("Error loading item history:", err);
      res.status(500).json({ error: "Erro ao carregar histórico" });
    }
  },
);

// ─── GET /api/audit/items — listagem e busca de itens do inventário ───────────
router.get(
  "/items",
  verifyJWT,
  requireInventoryAccess(),
  requireInventoryRoles("ADMIN_CICLO"),
  async (req, res) => {
    try {
      const { q = "", status, page = "1", limit = "40" } = req.query;
      const inventoryId = req.inventoryId;
      const skip = (parseInt(page) - 1) * parseInt(limit);

      const where = { inventoryId };

      if (q.trim()) {
        const norm = q.trim().toLowerCase();
        where.OR = [
          { patrimonio: { contains: norm } },
          { descricao: { contains: norm } },
        ];
      }

      if (status && ["SIM", "NAO", "PENDENTE"].includes(status)) {
        where.statusEncontrado = status;
      }

      const [total, items] = await Promise.all([
        prisma.item.count({ where }),
        prisma.item.findMany({
          where,
          select: {
            id: true,
            patrimonio: true,
            descricao: true,
            statusEncontrado: true,
            condicaoVisual: true,
            valor: true,
            space: { select: { id: true, name: true } },
            history: {
              orderBy: { createdAt: "desc" },
              take: 1,
              select: { action: true, createdBy: true, createdAt: true },
            },
          },
          orderBy: [{ patrimonio: "asc" }],
          skip,
          take: parseInt(limit),
        }),
      ]);

      // Resolve names for last actor
      const lastActors = [...new Set(items.map((i) => i.history[0]?.createdBy).filter(Boolean))];
      const nameMap = await buildNameMap(lastActors);

      res.json({
        total,
        page: parseInt(page),
        totalPages: Math.ceil(total / parseInt(limit)),
        items: items.map((item) => {
          const last = item.history[0];
          return {
            id: item.id,
            patrimonio: item.patrimonio,
            descricao: item.descricao,
            statusEncontrado: item.statusEncontrado,
            condicaoVisual: item.condicaoVisual,
            valor: item.valor,
            currentSpace: item.space ? { id: item.space.id, name: item.space.name } : null,
            lastAction: last
              ? { action: last.action, createdBy: nameMap[last.createdBy] || last.createdBy, createdAt: last.createdAt }
              : null,
          };
        }),
      });
    } catch (err) {
      console.error("Error listing items:", err);
      res.status(500).json({ error: "Erro ao listar itens" });
    }
  },
);

// ─── GET /api/audit/event-log — log de eventos da API ────────────────────────
router.get(
  "/event-log",
  verifyJWT,
  requireInventoryAccess(),
  requireRole("ADMIN"),
  async (req, res) => {
    try {
      const now = new Date();
      const defaultFrom = new Date(now - 7 * 24 * 60 * 60 * 1000);

      const from       = req.query.from   ? new Date(req.query.from)  : defaultFrom;
      const to         = req.query.to     ? new Date(req.query.to)    : now;
      const userId     = req.query.userId || null;
      const onlyErrors = req.query.onlyErrors === "true";
      const limit      = Math.min(Number(req.query.limit  || 100), 500);
      const offset     = Math.max(Number(req.query.offset || 0),   0);

      const { rows, total } = await queryEventLog({
        inventoryId: req.inventoryId,
        from, to, userId, onlyErrors, limit, offset,
      });

      return res.json({ rows, total, limit, offset });
    } catch (err) {
      console.error("[audit] event-log error:", err);
      return res.status(500).json({ error: "Erro ao consultar log de eventos" });
    }
  },
);

// ─── GET /api/audit/event-log/insights — agregações e insights ───────────────
router.get(
  "/event-log/insights",
  verifyJWT,
  requireInventoryAccess(),
  requireRole("ADMIN"),
  async (req, res) => {
    try {
      const now = new Date();
      const defaultFrom = new Date(now - 7 * 24 * 60 * 60 * 1000);
      const from = req.query.from ? new Date(req.query.from) : defaultFrom;
      const to   = req.query.to   ? new Date(req.query.to)   : now;

      const insights = await getEventLogInsights({
        inventoryId: req.inventoryId,
        from, to,
      });

      return res.json(insights);
    } catch (err) {
      console.error("[audit] insights error:", err);
      return res.status(500).json({ error: "Erro ao gerar insights" });
    }
  },
);

// ─── GET /api/audit/event-log/users — lista usuários que geraram eventos ─────
router.get(
  "/event-log/users",
  verifyJWT,
  requireInventoryAccess(),
  requireRole("ADMIN"),
  async (req, res) => {
    try {
      const now = new Date();
      const from = req.query.from ? new Date(req.query.from) : new Date(now - 30 * 24 * 60 * 60 * 1000);
      const to   = req.query.to   ? new Date(req.query.to)   : now;

      const rows = await prisma.$queryRawUnsafe(
        `SELECT DISTINCT user_id, user_name
         FROM api_event_log
         WHERE ts BETWEEN $1 AND $2 AND inventory_id = $3 AND user_id IS NOT NULL
         ORDER BY user_name ASC`,
        from, to, req.inventoryId,
      );
      return res.json(rows.map(r => ({ userId: r.user_id, userName: r.user_name })));
    } catch (err) {
      return res.status(500).json({ error: "Erro ao listar usuários" });
    }
  },
);

export default router;
