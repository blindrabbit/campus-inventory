import { prisma } from "../prisma/client.js";
import { randomUUID } from "crypto";

export async function ensureEventLogTable() {
  await prisma.$executeRaw`
    CREATE TABLE IF NOT EXISTS api_event_log (
      id          TEXT        PRIMARY KEY,
      ts          TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
      user_id     TEXT,
      user_name   TEXT,
      method      TEXT        NOT NULL,
      path        TEXT        NOT NULL,
      status_code INTEGER     NOT NULL,
      response_ms INTEGER,
      inventory_id TEXT,
      error_msg   TEXT
    )
  `;
  await prisma.$executeRaw`
    CREATE INDEX IF NOT EXISTS idx_api_event_log_ts
    ON api_event_log (ts DESC)
  `;
  await prisma.$executeRaw`
    CREATE INDEX IF NOT EXISTS idx_api_event_log_inv_ts
    ON api_event_log (inventory_id, ts DESC)
  `;
}

// Substitui IDs dinâmicos (CUIDs, UUIDs, numéricos) por :id para agrupamento
function normalizePath(path) {
  return path
    .replace(/\/[a-z0-9]{20,}\b/gi, "/:id")
    .replace(/\/\d+\b/g, "/:num");
}

export async function logApiEvent(data) {
  try {
    await prisma.$executeRawUnsafe(
      `INSERT INTO api_event_log
         (id, user_id, user_name, method, path, status_code, response_ms, inventory_id, error_msg)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
      randomUUID(),
      data.userId ?? null,
      data.userName ?? null,
      data.method,
      normalizePath(data.path),
      data.statusCode,
      data.responseMs ?? null,
      data.inventoryId ?? null,
      data.errorMsg ?? null,
    );
  } catch {
    // Nunca deve bloquear ou propagar erros
  }
}

export async function queryEventLog({ inventoryId, from, to, userId, onlyErrors, limit = 100, offset = 0 }) {
  const conditions = ["ts BETWEEN $1 AND $2"];
  const params = [new Date(from), new Date(to)];
  let p = 3;

  if (inventoryId) { conditions.push(`inventory_id = $${p++}`); params.push(inventoryId); }
  if (userId)      { conditions.push(`user_id = $${p++}`);      params.push(userId); }
  if (onlyErrors)  { conditions.push(`status_code >= 400`); }

  const where = conditions.join(" AND ");

  const [rows, totalRows] = await Promise.all([
    prisma.$queryRawUnsafe(
      `SELECT id, ts, user_id, user_name, method, path, status_code, response_ms, inventory_id, error_msg
       FROM api_event_log WHERE ${where}
       ORDER BY ts DESC LIMIT ${Number(limit)} OFFSET ${Number(offset)}`,
      ...params,
    ),
    prisma.$queryRawUnsafe(
      `SELECT COUNT(*) as n FROM api_event_log WHERE ${where}`,
      ...params,
    ),
  ]);

  return { rows, total: Number(totalRows[0].n) };
}

export async function getEventLogInsights({ inventoryId, from, to }) {
  const base = [new Date(from), new Date(to)];
  const invFilter = inventoryId ? `AND inventory_id = $3` : "";
  const params = inventoryId ? [...base, inventoryId] : base;

  const [stats, topErrors, topEndpoints, topUsers, byDay] = await Promise.all([
    prisma.$queryRawUnsafe(
      `SELECT
         COUNT(*) as total,
         SUM(CASE WHEN status_code >= 400 THEN 1 ELSE 0 END) as errors,
         SUM(CASE WHEN status_code >= 500 THEN 1 ELSE 0 END) as server_errors,
         ROUND(AVG(response_ms)) as avg_ms,
         ROUND(MAX(response_ms)) as max_ms
       FROM api_event_log
       WHERE ts BETWEEN $1 AND $2 ${invFilter}`,
      ...params,
    ),

    prisma.$queryRawUnsafe(
      `SELECT error_msg, COUNT(*) as count
       FROM api_event_log
       WHERE ts BETWEEN $1 AND $2 ${invFilter} AND status_code >= 400 AND error_msg IS NOT NULL
       GROUP BY error_msg ORDER BY count DESC LIMIT 8`,
      ...params,
    ),

    prisma.$queryRawUnsafe(
      `SELECT method, path, COUNT(*) as total,
              SUM(CASE WHEN status_code >= 400 THEN 1 ELSE 0 END) as errors,
              ROUND(AVG(response_ms)) as avg_ms
       FROM api_event_log
       WHERE ts BETWEEN $1 AND $2 ${invFilter}
       GROUP BY method, path ORDER BY errors DESC, total DESC LIMIT 8`,
      ...params,
    ),

    prisma.$queryRawUnsafe(
      `SELECT user_id, user_name, COUNT(*) as total,
              SUM(CASE WHEN status_code >= 400 THEN 1 ELSE 0 END) as errors
       FROM api_event_log
       WHERE ts BETWEEN $1 AND $2 ${invFilter} AND user_id IS NOT NULL
       GROUP BY user_id, user_name ORDER BY errors DESC, total DESC LIMIT 8`,
      ...params,
    ),

    prisma.$queryRawUnsafe(
      `SELECT TO_CHAR(DATE_TRUNC('day', ts), 'YYYY-MM-DD') as day,
              COUNT(*) as total,
              SUM(CASE WHEN status_code >= 400 THEN 1 ELSE 0 END) as errors
       FROM api_event_log
       WHERE ts BETWEEN $1 AND $2 ${invFilter}
       GROUP BY day ORDER BY day ASC`,
      ...params,
    ),
  ]);

  const s = stats[0];
  return {
    total: Number(s.total),
    errors: Number(s.errors),
    serverErrors: Number(s.server_errors),
    errorRate: s.total > 0 ? Math.round((Number(s.errors) / Number(s.total)) * 100) : 0,
    avgMs: Number(s.avg_ms ?? 0),
    maxMs: Number(s.max_ms ?? 0),
    topErrors:     topErrors.map(r => ({ msg: r.error_msg, count: Number(r.count) })),
    topEndpoints:  topEndpoints.map(r => ({ method: r.method, path: r.path, total: Number(r.total), errors: Number(r.errors), avgMs: Number(r.avg_ms ?? 0) })),
    topUsers:      topUsers.map(r => ({ userId: r.user_id, userName: r.user_name, total: Number(r.total), errors: Number(r.errors) })),
    byDay:         byDay.map(r => ({ day: r.day, total: Number(r.total), errors: Number(r.errors) })),
  };
}
