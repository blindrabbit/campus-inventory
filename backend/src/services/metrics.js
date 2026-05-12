import { prisma } from "../prisma/client.js";

export async function ensureSpaceCountersTable() {
  await prisma.$executeRaw`
    CREATE TABLE IF NOT EXISTS space_counters (
      spaceId TEXT PRIMARY KEY,
      inventoryId TEXT NOT NULL,
      total_items INTEGER NOT NULL DEFAULT 0,
      checked_count INTEGER NOT NULL DEFAULT 0,
      unfound_count INTEGER NOT NULL DEFAULT 0,
      pending_count INTEGER NOT NULL DEFAULT 0,
      relocated_pending INTEGER NOT NULL DEFAULT 0,
      last_updated TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
    )
  `;

  await prisma.$executeRaw`
    CREATE INDEX IF NOT EXISTS idx_space_counters_inventory
    ON space_counters (inventoryId)
  `;
}

export async function recomputeSpaceCounters(spaceId, inventoryId) {
  if (!spaceId) return null;

  const total = await prisma.item.count({ where: { inventoryId, spaceId } });
  const checked = await prisma.item.count({
    where: { inventoryId, spaceId, statusEncontrado: "SIM" },
  });
  const unfound = await prisma.item.count({
    where: { inventoryId, spaceId, statusEncontrado: "NAO" },
  });
  const pending = await prisma.item.count({
    where: { inventoryId, spaceId, statusEncontrado: "PENDENTE" },
  });
  const relocatedPending = await prisma.relocation.count({
    where: { toSpaceId: spaceId, pendingConfirm: true, item: { inventoryId } },
  });

  await prisma.$executeRaw`
    INSERT INTO space_counters (spaceId, inventoryId, total_items, checked_count, unfound_count, pending_count, relocated_pending, last_updated)
    VALUES (${spaceId}, ${inventoryId}, ${total}, ${checked}, ${unfound}, ${pending}, ${relocatedPending}, ${new Date()})
    ON CONFLICT(spaceId) DO UPDATE SET
      total_items=excluded.total_items,
      checked_count=excluded.checked_count,
      unfound_count=excluded.unfound_count,
      pending_count=excluded.pending_count,
      relocated_pending=excluded.relocated_pending,
      last_updated=excluded.last_updated
  `;

  return { spaceId, inventoryId, total, checked, unfound, pending, relocatedPending };
}

export async function incrementSpaceCounters(spaceId, inventoryId, deltas = {}) {
  if (!spaceId) return null;

  const {
    deltaTotal = 0,
    deltaChecked = 0,
    deltaUnfound = 0,
    deltaPending = 0,
    deltaRelocatedPending = 0,
  } = deltas;

  // Ensure row exists (insert with zeroes if missing)
  await prisma.$executeRaw`
    INSERT INTO space_counters (spaceId, inventoryId)
    VALUES (${spaceId}, ${inventoryId})
    ON CONFLICT(spaceId) DO NOTHING
  `;

  await prisma.$executeRaw`
    UPDATE space_counters SET
      total_items = total_items + ${deltaTotal},
      checked_count = checked_count + ${deltaChecked},
      unfound_count = unfound_count + ${deltaUnfound},
      pending_count = pending_count + ${deltaPending},
      relocated_pending = relocated_pending + ${deltaRelocatedPending},
      last_updated = ${new Date()}
    WHERE spaceId = ${spaceId}
  `;

  const row = await prisma.$queryRaw`
    SELECT * FROM space_counters WHERE spaceId = ${spaceId}
  `;
  return Array.isArray(row) && row[0] ? row[0] : null;
}

export async function recomputeAllSpaceCounters(inventoryId) {
  const spaces = await prisma.space.findMany({
    where: { inventoryId },
    select: { id: true },
  });
  for (const space of spaces) {
    await recomputeSpaceCounters(space.id, inventoryId);
  }
}

export async function getInventoryCounters(inventoryId) {
  const rows = await prisma.$queryRaw`
    SELECT inventoryId, SUM(total_items) as total_items, SUM(checked_count) as checked_count,
           SUM(unfound_count) as unfound_count, SUM(pending_count) as pending_count,
           SUM(relocated_pending) as relocated_pending
    FROM space_counters WHERE inventoryId = ${inventoryId}
    GROUP BY inventoryId
  `;
  return rows && rows[0] ? rows[0] : null;
}
