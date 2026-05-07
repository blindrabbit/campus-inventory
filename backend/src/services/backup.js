import fs from "fs";
import path from "path";
import { prisma } from "../prisma/client.js";

// Directory where SQL backup files are stored
const BACKUP_DIR = path.resolve(process.cwd(), ".dev-data", "backups");

export function ensureBackupDir() {
  fs.mkdirSync(BACKUP_DIR, { recursive: true });
}

// ─── SQL value escaping ───────────────────────────────────────────────────────

function sqlVal(v) {
  if (v === null || v === undefined) return "NULL";
  if (typeof v === "boolean") return v ? "1" : "0";
  if (v instanceof Date) return `'${v.toISOString()}'`;
  if (typeof v === "number") return String(v);
  // Escape single quotes inside strings
  return `'${String(v).replace(/'/g, "''")}'`;
}

function rowToInsert(table, row) {
  const cols = Object.keys(row).join(", ");
  const vals = Object.values(row).map(sqlVal).join(", ");
  return `INSERT INTO ${table} (${cols}) VALUES (${vals});`;
}

// ─── SQL generation ───────────────────────────────────────────────────────────

export async function generateInventorySQL(inventoryId) {
  const lines = [];

  lines.push("-- Campus Inventory Backup");
  lines.push(`-- Inventory ID: ${inventoryId}`);
  lines.push(`-- Generated at: ${new Date().toISOString()}`);
  lines.push("");
  lines.push("PRAGMA foreign_keys = OFF;");
  lines.push("BEGIN TRANSACTION;");
  lines.push("");

  // 1. Inventory
  const inventory = await prisma.inventory.findUnique({ where: { id: inventoryId } });
  if (!inventory) throw new Error("Inventário não encontrado");

  lines.push("-- inventories");
  lines.push(rowToInsert("inventories", {
    id: inventory.id, name: inventory.name, campus: inventory.campus,
    sourceType: inventory.sourceType, statusOperacao: inventory.statusOperacao,
    baseInventoryId: inventory.baseInventoryId, createdById: inventory.createdById,
    startedAt: inventory.startedAt, finishedAt: inventory.finishedAt,
    createdAt: inventory.createdAt, updatedAt: inventory.updatedAt,
  }));
  lines.push("");

  // 2. InventoryUsers
  const invUsers = await prisma.inventoryUser.findMany({ where: { inventoryId } });
  if (invUsers.length > 0) {
    lines.push("-- inventory_users");
    for (const r of invUsers) {
      lines.push(rowToInsert("inventory_users", {
        id: r.id, inventoryId: r.inventoryId, userId: r.userId,
        role: r.role, createdAt: r.createdAt, updatedAt: r.updatedAt,
      }));
    }
    lines.push("");
  }

  // 3. InventoryStatusHistory
  const statusHistory = await prisma.inventoryStatusHistory.findMany({ where: { inventoryId } });
  if (statusHistory.length > 0) {
    lines.push("-- inventory_status_history");
    for (const r of statusHistory) {
      lines.push(rowToInsert("inventory_status_history", {
        id: r.id, inventoryId: r.inventoryId, fromStatus: r.fromStatus,
        toStatus: r.toStatus, changedBy: r.changedBy, changedAt: r.changedAt,
      }));
    }
    lines.push("");
  }

  // 4. ItemGroups
  const itemGroups = await prisma.itemGroup.findMany({ where: { inventoryId } });
  if (itemGroups.length > 0) {
    lines.push("-- item_groups");
    for (const r of itemGroups) {
      lines.push(rowToInsert("item_groups", {
        id: r.id, inventoryId: r.inventoryId, name: r.name,
        description: r.description, createdAt: r.createdAt, updatedAt: r.updatedAt,
      }));
    }
    lines.push("");
  }

  // 5. Spaces
  const spaces = await prisma.space.findMany({ where: { inventoryId } });
  if (spaces.length > 0) {
    lines.push("-- spaces");
    for (const r of spaces) {
      lines.push(rowToInsert("spaces", {
        id: r.id, name: r.name, responsible: r.responsible, sector: r.sector,
        unit: r.unit, inventoryId: r.inventoryId, isActive: r.isActive,
        isFinalized: r.isFinalized, isVerifiedByRevisor: r.isVerifiedByRevisor,
        startedAt: r.startedAt, startedBy: r.startedBy, observacoes: r.observacoes,
        createdAt: r.createdAt, updatedAt: r.updatedAt,
      }));
    }
    lines.push("");
  }

  // 6. Items
  const items = await prisma.item.findMany({ where: { inventoryId } });
  const itemIds = items.map((i) => i.id);
  if (items.length > 0) {
    lines.push("-- items");
    for (const r of items) {
      lines.push(rowToInsert("items", {
        id: r.id, patrimonio: r.patrimonio, descricao: r.descricao,
        valor: r.valor, condicaoOriginal: r.condicaoOriginal,
        fornecedor: r.fornecedor, cnpj_fornecedor: r.cnpjFornecedor,
        catalogo: r.catalogo, codigo_sia: r.codigoSIA, descricao_sia: r.descricaoSIA,
        numero_entrada: r.numeroEntrada, data_entrada: r.dataEntrada,
        data_aquisicao: r.dataAquisicao, documento: r.documento,
        data_documento: r.dataDocumento, tipo_aquisicao: r.tipoAquisicao,
        inventoryId: r.inventoryId, spaceId: r.spaceId,
        lastKnownSpaceId: r.lastKnownSpaceId,
        Encontrado: r.statusEncontrado, condicaoVisual: r.condicaoVisual,
        dataConferencia: r.dataConferencia, ultimoConferente: r.ultimoConferente,
        verificationStatus: r.verificationStatus, verifiedAt: r.verifiedAt,
        verifiedBy: r.verifiedBy, itemGroupId: r.itemGroupId,
        createdAt: r.createdAt, updatedAt: r.updatedAt,
      }));
    }
    lines.push("");
  }

  // 7. ItemHistorico
  if (itemIds.length > 0) {
    const history = await prisma.itemHistorico.findMany({
      where: { itemId: { in: itemIds } },
    });
    if (history.length > 0) {
      lines.push("-- item_history");
      for (const r of history) {
        lines.push(rowToInsert("item_history", {
          id: r.id, itemId: r.itemId, fromSpaceId: r.fromSpaceId,
          toSpaceId: r.toSpaceId, action: r.action, reason: r.reason,
          createdBy: r.createdBy, metadata: r.metadata, createdAt: r.createdAt,
        }));
      }
      lines.push("");
    }

    // 8. Relocations
    const relocations = await prisma.relocation.findMany({
      where: { itemId: { in: itemIds } },
    });
    if (relocations.length > 0) {
      lines.push("-- relocations");
      for (const r of relocations) {
        lines.push(rowToInsert("relocations", {
          id: r.id, itemId: r.itemId, fromSpaceId: r.fromSpaceId,
          toSpaceId: r.toSpaceId, movedBy: r.movedBy, movedAt: r.movedAt,
          pendingConfirm: r.pendingConfirm, wasUnfound: r.wasUnfound,
        }));
      }
      lines.push("");
    }
  }

  // 9. VerificationRolls
  const spaceIds = spaces.map((s) => s.id);
  if (spaceIds.length > 0) {
    const verRolls = await prisma.verificationRoll.findMany({
      where: { spaceId: { in: spaceIds } },
    });
    if (verRolls.length > 0) {
      lines.push("-- verification_rolls");
      for (const r of verRolls) {
        lines.push(rowToInsert("verification_rolls", {
          id: r.id, spaceId: r.spaceId, itemIds: r.itemIds,
          selectedAt: r.selectedAt, reviewedAt: r.reviewedAt,
          result: r.result, reason: r.reason, createdBy: r.createdBy,
          updatedAt: r.updatedAt,
        }));
      }
      lines.push("");
    }

    // 10. FinalizationHistory
    const finHistory = await prisma.finalizationHistory.findMany({
      where: { spaceId: { in: spaceIds } },
    });
    if (finHistory.length > 0) {
      lines.push("-- finalization_history");
      for (const r of finHistory) {
        lines.push(rowToInsert("finalization_history", {
          id: r.id, spaceId: r.spaceId, action: r.action,
          reason: r.reason, actedBy: r.actedBy, actedAt: r.actedAt,
        }));
      }
      lines.push("");
    }
  }

  lines.push("COMMIT;");
  lines.push("PRAGMA foreign_keys = ON;");

  return lines.join("\n");
}

// ─── Lock helpers ─────────────────────────────────────────────────────────────

export async function acquireLock(inventoryId, reason, lockedBy) {
  await prisma.systemLock.create({ data: { inventoryId, reason, lockedBy } });
}

export async function releaseLock(inventoryId) {
  await prisma.systemLock.deleteMany({ where: { inventoryId } });
}

export async function getLockStatus(inventoryId) {
  return prisma.systemLock.findUnique({ where: { inventoryId } });
}

// ─── Create backup ────────────────────────────────────────────────────────────

export async function createBackup({ inventoryId, createdBy, label = null, isScheduled = false }) {
  ensureBackupDir();

  const inventoryDir = path.join(BACKUP_DIR, inventoryId);
  fs.mkdirSync(inventoryDir, { recursive: true });

  const ts = new Date().toISOString().replace(/[:.]/g, "-");
  const fileName = `backup_${ts}.sql`;
  const filePath = path.join(inventoryDir, fileName);

  // Register as IN_PROGRESS
  const record = await prisma.backupRecord.create({
    data: {
      inventoryId, createdBy, label, fileName,
      filePath, status: "IN_PROGRESS", isScheduled,
    },
  });

  try {
    await acquireLock(inventoryId, "BACKUP", createdBy);
    const sql = await generateInventorySQL(inventoryId);
    fs.writeFileSync(filePath, sql, "utf8");
    const fileSizeBytes = fs.statSync(filePath).size;

    const updated = await prisma.backupRecord.update({
      where: { id: record.id },
      data: { status: "COMPLETED", fileSizeBytes },
    });

    return updated;
  } catch (err) {
    await prisma.backupRecord.update({
      where: { id: record.id },
      data: { status: "FAILED", errorMessage: err.message },
    });
    throw err;
  } finally {
    await releaseLock(inventoryId);
  }
}

// ─── Restore backup ───────────────────────────────────────────────────────────

export async function restoreBackup({ backupId, requestedBy }) {
  const record = await prisma.backupRecord.findUnique({ where: { id: backupId } });
  if (!record) throw new Error("Backup não encontrado");
  if (record.status !== "COMPLETED") throw new Error("Backup inválido ou incompleto");
  if (!fs.existsSync(record.filePath)) throw new Error("Arquivo de backup não encontrado no servidor");

  const { inventoryId } = record;

  // Safety: create a backup of the current state before restoring.
  // If this fails, abort — do not proceed with a restore that has no safety net.
  await createBackup({
    inventoryId,
    createdBy: requestedBy,
    label: "Backup de segurança pré-restauração",
    isScheduled: false,
  });

  // Preserve backup operational data before cascade-delete wipes it.
  // BackupRecord/BackupSchedule have onDelete: Cascade on Inventory, so they
  // would be lost when the inventory row is deleted during restore.
  const savedBackupRecords = await prisma.backupRecord.findMany({ where: { inventoryId } });
  const savedBackupSchedule = await prisma.backupSchedule.findUnique({ where: { inventoryId } });

  await acquireLock(inventoryId, "RESTORE", requestedBy);
  try {
    const sql = fs.readFileSync(record.filePath, "utf8");

    // Delete all existing inventory data in reverse FK order
    const spaces = await prisma.space.findMany({ where: { inventoryId }, select: { id: true } });
    const spaceIds = spaces.map((s) => s.id);
    const items = await prisma.item.findMany({ where: { inventoryId }, select: { id: true } });
    const itemIds = items.map((i) => i.id);

    if (spaceIds.length > 0) {
      await prisma.finalizationHistory.deleteMany({ where: { spaceId: { in: spaceIds } } });
      await prisma.verificationRoll.deleteMany({ where: { spaceId: { in: spaceIds } } });
    }
    if (itemIds.length > 0) {
      await prisma.itemHistorico.deleteMany({ where: { itemId: { in: itemIds } } });
      await prisma.relocation.deleteMany({ where: { itemId: { in: itemIds } } });
    }
    await prisma.item.deleteMany({ where: { inventoryId } });
    await prisma.itemGroup.deleteMany({ where: { inventoryId } });
    await prisma.space.deleteMany({ where: { inventoryId } });
    await prisma.inventoryStatusHistory.deleteMany({ where: { inventoryId } });
    await prisma.inventoryUser.deleteMany({ where: { inventoryId } });
    // Cascade on Inventory also deletes backupRecords and backupSchedule
    await prisma.inventory.deleteMany({ where: { id: inventoryId } });

    // Execute restore SQL using raw queries statement by statement
    const statements = sql
      .split("\n")
      .map((l) => l.trim())
      .filter((l) => l && !l.startsWith("--") && !l.startsWith("PRAGMA") && !l.startsWith("BEGIN") && !l.startsWith("COMMIT"))
      .join("\n")
      .split(";")
      .map((s) => s.trim())
      .filter(Boolean);

    for (const stmt of statements) {
      await prisma.$executeRawUnsafe(stmt);
    }

    // Re-insert preserved backup operational data (not part of inventory business data)
    for (const r of savedBackupRecords) {
      await prisma.backupRecord.create({
        data: {
          id: r.id, inventoryId: r.inventoryId, fileName: r.fileName,
          filePath: r.filePath, label: r.label, status: r.status,
          fileSizeBytes: r.fileSizeBytes, errorMessage: r.errorMessage,
          isScheduled: r.isScheduled, createdBy: r.createdBy, createdAt: r.createdAt,
        },
      });
    }
    if (savedBackupSchedule) {
      await prisma.backupSchedule.create({
        data: {
          id: savedBackupSchedule.id, inventoryId: savedBackupSchedule.inventoryId,
          intervalHours: savedBackupSchedule.intervalHours, nextRunAt: savedBackupSchedule.nextRunAt,
          lastRunAt: savedBackupSchedule.lastRunAt, isActive: savedBackupSchedule.isActive,
          createdBy: savedBackupSchedule.createdBy, createdAt: savedBackupSchedule.createdAt,
        },
      });
    }

    return { success: true, inventoryId };
  } finally {
    await releaseLock(inventoryId);
  }
}

// ─── Scheduler ────────────────────────────────────────────────────────────────

let schedulerInterval = null;

async function runDueSchedules() {
  try {
    const now = new Date();
    const due = await prisma.backupSchedule.findMany({
      where: { isActive: true, nextRunAt: { lte: now } },
    });

    for (const schedule of due) {
      // Skip if inventory is already locked
      const lock = await getLockStatus(schedule.inventoryId);
      if (lock) continue;

      console.log(`[Backup Scheduler] Running scheduled backup for inventory ${schedule.inventoryId}`);
      try {
        await createBackup({
          inventoryId: schedule.inventoryId,
          createdBy: schedule.createdBy,
          label: "Backup automático",
          isScheduled: true,
        });
      } catch (err) {
        console.error(`[Backup Scheduler] Failed for inventory ${schedule.inventoryId}:`, err.message);
      }

      const nextRunAt = new Date(now.getTime() + schedule.intervalHours * 60 * 60 * 1000);
      await prisma.backupSchedule.update({
        where: { id: schedule.id },
        data: { lastRunAt: now, nextRunAt },
      });
    }
  } catch (err) {
    console.error("[Backup Scheduler] Error:", err.message);
  }
}

export function startBackupScheduler() {
  if (schedulerInterval) return;
  // Check every 60 seconds
  schedulerInterval = setInterval(runDueSchedules, 60_000);
  console.log("🗄️  Backup scheduler iniciado");
}
