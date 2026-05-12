import fs from "fs";
import path from "path";
import { createHash } from "crypto";
import { prisma } from "../prisma/client.js";

// Directory where SQL backup files are stored
const BACKUP_DIR = path.resolve(process.cwd(), ".dev-data", "backups");

export function ensureBackupDir() {
  fs.mkdirSync(BACKUP_DIR, { recursive: true });
}

// ─── SQL value escaping ───────────────────────────────────────────────────────

function sqlVal(v) {
  if (v === null || v === undefined) return "NULL";
  if (typeof v === "boolean") return v ? "TRUE" : "FALSE";
  if (v instanceof Date) return `'${v.toISOString()}'`;
  if (typeof v === "number") return String(v);
  // Escape single quotes inside strings
  return `'${String(v).replace(/'/g, "''")}'`;
}

function rowToInsert(table, row) {
  const cols = Object.keys(row).map((k) => `"${k}"`).join(", ");
  const vals = Object.values(row).map(sqlVal).join(", ");
  return `INSERT INTO "${table}" (${cols}) VALUES (${vals});`;
}

// ─── SQL generation ───────────────────────────────────────────────────────────

export async function generateInventorySQL(inventoryId, generatedAt = new Date()) {
  const lines = [];

  lines.push("-- Campus Inventory Backup");
  lines.push(`-- Inventory ID: ${inventoryId}`);
  lines.push(`-- Generated at: ${generatedAt.toISOString()}`);
  lines.push("");
  lines.push("BEGIN;");
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
    const generatedAt = new Date();
    const sql = await generateInventorySQL(inventoryId, generatedAt);

    // Hash calculado sobre o SQL sem a linha de timestamp (linha 3),
    // para que backups com conteúdo idêntico mas timestamps diferentes sejam detectados.
    const sqlForHash = sql.split("\n").filter((l) => !l.startsWith("-- Generated at:")).join("\n");
    const contentHash = createHash("sha256").update(sqlForHash).digest("hex");

    fs.writeFileSync(filePath, sql, "utf8");
    const fileSizeBytes = fs.statSync(filePath).size;

    // ── Deduplicação: apenas para backups agendados ──────────────────────────
    // Busca o backup agendado anterior mais recente com status COMPLETED
    let dedupCount = 0;
    if (isScheduled) {
      const prev = await prisma.backupRecord.findFirst({
        where: {
          inventoryId,
          isScheduled: true,
          status: "COMPLETED",
          id: { not: record.id },
          contentHash: { not: null },
        },
        orderBy: { createdAt: "desc" },
      });

      if (prev?.contentHash === contentHash) {
        // Conteúdo idêntico: herda a contagem acumulada e descarta o anterior
        dedupCount = (prev.dedupCount ?? 0) + 1;

        // Remove arquivo do disco (ignorar se já não existir)
        try { fs.unlinkSync(prev.filePath); } catch { /* arquivo já ausente */ }

        await prisma.backupRecord.delete({ where: { id: prev.id } });

        console.log(
          `[Backup] Backup agendado idêntico ao anterior — descartado ${prev.id} ` +
          `(duplicata #${dedupCount} para inventário ${inventoryId})`
        );
      }
    }

    const updated = await prisma.backupRecord.update({
      where: { id: record.id },
      data: { status: "COMPLETED", fileSizeBytes, contentHash, dedupCount },
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

// Colunas booleanas conhecidas — usadas para converter 1/0 (SQLite) → TRUE/FALSE (PG)
const BOOLEAN_COLUMNS = new Set([
  "isActive", "isFinalized", "isVerifiedByRevisor",
  "pendingConfirm", "wasUnfound", "isScheduled",
]);

// Tokenizador simples de lista de valores SQL, respeitando strings com aspas simples
function tokenizeValues(valStr) {
  const tokens = [];
  let i = 0;
  let current = "";

  while (i < valStr.length) {
    const ch = valStr[i];
    if (ch === "'") {
      current = "'";
      i++;
      while (i < valStr.length) {
        if (valStr[i] === "'" && valStr[i + 1] === "'") {
          current += "''"; i += 2;
        } else if (valStr[i] === "'") {
          current += "'"; i++; break;
        } else {
          current += valStr[i++];
        }
      }
      tokens.push(current); current = "";
    } else if (ch === ",") {
      if (current.trim()) tokens.push(current.trim());
      current = ""; i++;
    } else {
      current += ch; i++;
    }
  }
  if (current.trim()) tokens.push(current.trim());
  return tokens;
}

// Corrige valores booleanos em INSERTs gerados no formato SQLite (1/0 → TRUE/FALSE)
function fixInsertBooleans(stmt) {
  const match = stmt.match(/^INSERT INTO "?(\w+)"?\s*\(([^)]+)\)\s*VALUES\s*\((.+)\)$/is);
  if (!match) return stmt;

  const cols = match[2].split(",").map((c) => c.trim().replace(/["`]/g, ""));
  const vals = tokenizeValues(match[3]);

  const fixed = vals.map((v, i) => {
    if (i < cols.length && BOOLEAN_COLUMNS.has(cols[i])) {
      if (v === "1") return "TRUE";
      if (v === "0") return "FALSE";
    }
    return v;
  });

  const quotedCols = cols.map((c) => `"${c}"`).join(", ");
  return `INSERT INTO "${match[1]}" (${quotedCols}) VALUES (${fixed.join(", ")})`;
}

// Extrai e normaliza statements do SQL de backup para execução no PostgreSQL.
// Usa um parser que respeita strings entre aspas simples, evitando split incorreto
// em valores que contêm ';' (ex: "ATKINS, PETER; JONES, LORETTA").
function parseRestoreStatements(sql) {
  // Primeiro, remove linhas de controle (comentários, PRAGMA, BEGIN, COMMIT)
  const filtered = sql
    .split("\n")
    .filter((l) => {
      const t = l.trim();
      return (
        t &&
        !t.startsWith("--") &&
        !t.startsWith("PRAGMA") &&
        !t.toUpperCase().startsWith("BEGIN") &&
        !t.toUpperCase().startsWith("COMMIT")
      );
    })
    .join("\n");

  // Divide em statements respeitando strings entre aspas simples
  const statements = [];
  let current = "";
  let inStr = false;
  let i = 0;

  while (i < filtered.length) {
    const ch = filtered[i];
    if (inStr) {
      if (ch === "'" && filtered[i + 1] === "'") {
        current += "''"; i += 2;          // '' é aspas escapada dentro de string
      } else if (ch === "'") {
        current += ch; inStr = false; i++; // fecha a string
      } else {
        current += ch; i++;
      }
    } else {
      if (ch === "'") {
        inStr = true; current += ch; i++;  // abre string
      } else if (ch === ";") {
        const stmt = current.trim();
        if (stmt) statements.push(stmt);
        current = ""; i++;
      } else {
        current += ch; i++;
      }
    }
  }
  const tail = current.trim();
  if (tail) statements.push(tail);

  return statements.map(fixInsertBooleans);
}

export async function restoreBackup({ backupId, requestedBy }) {
  const record = await prisma.backupRecord.findUnique({ where: { id: backupId } });
  if (!record) throw new Error("Backup não encontrado");
  if (record.status !== "COMPLETED") throw new Error("Backup inválido ou incompleto");
  if (!fs.existsSync(record.filePath)) throw new Error("Arquivo de backup não encontrado no servidor");

  const { inventoryId } = record;

  // Cria backup de segurança do estado atual antes de qualquer alteração.
  // Se falhar, aborta — não restaura sem rede de segurança.
  await createBackup({
    inventoryId,
    createdBy: requestedBy,
    label: "Backup de segurança pré-restauração",
    isScheduled: false,
  });

  // Preserva registros operacionais de backup antes de o cascade os apagar.
  const savedBackupRecords = await prisma.backupRecord.findMany({ where: { inventoryId } });
  const savedBackupSchedule = await prisma.backupSchedule.findUnique({ where: { inventoryId } });

  const sql = fs.readFileSync(record.filePath, "utf8");
  const statements = parseRestoreStatements(sql);

  await acquireLock(inventoryId, "RESTORE", requestedBy);
  try {
    // Tudo dentro de uma única transação PostgreSQL:
    // se qualquer statement falhar → rollback automático → dados preservados.
    await prisma.$transaction(
      async (tx) => {
        // 1. Delete em ordem reversa de FK
        const spaces = await tx.space.findMany({ where: { inventoryId }, select: { id: true } });
        const spaceIds = spaces.map((s) => s.id);
        const items = await tx.item.findMany({ where: { inventoryId }, select: { id: true } });
        const itemIds = items.map((i) => i.id);

        if (spaceIds.length > 0) {
          await tx.finalizationHistory.deleteMany({ where: { spaceId: { in: spaceIds } } });
          await tx.verificationRoll.deleteMany({ where: { spaceId: { in: spaceIds } } });
        }
        if (itemIds.length > 0) {
          await tx.itemHistorico.deleteMany({ where: { itemId: { in: itemIds } } });
          await tx.relocation.deleteMany({ where: { itemId: { in: itemIds } } });
        }
        await tx.item.deleteMany({ where: { inventoryId } });
        await tx.itemGroup.deleteMany({ where: { inventoryId } });
        await tx.space.deleteMany({ where: { inventoryId } });
        await tx.inventoryStatusHistory.deleteMany({ where: { inventoryId } });
        await tx.inventoryUser.deleteMany({ where: { inventoryId } });
        await tx.inventory.deleteMany({ where: { id: inventoryId } });

        // 2. Re-insere a partir do SQL do backup
        for (const stmt of statements) {
          await tx.$executeRawUnsafe(stmt);
        }

        // 3. Re-insere registros operacionais de backup preservados (upsert para evitar conflito de IDs)
        for (const r of savedBackupRecords) {
          await tx.$executeRawUnsafe(
            `INSERT INTO backup_records
               (id, "inventoryId", "createdBy", "createdAt", label, "fileName", "filePath",
                "fileSizeBytes", status, "errorMessage", "isScheduled", "contentHash", "dedupCount")
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
             ON CONFLICT (id) DO NOTHING`,
            r.id, r.inventoryId, r.createdBy, r.createdAt, r.label ?? null,
            r.fileName, r.filePath, r.fileSizeBytes, r.status, r.errorMessage ?? null,
            r.isScheduled, r.contentHash ?? null, r.dedupCount ?? 0
          );
        }
        if (savedBackupSchedule) {
          await tx.$executeRawUnsafe(
            `INSERT INTO backup_schedules
               (id, "inventoryId", "intervalHours", "isActive", "lastRunAt", "nextRunAt",
                "createdBy", "createdAt", "updatedAt")
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
             ON CONFLICT (id) DO NOTHING`,
            savedBackupSchedule.id, savedBackupSchedule.inventoryId,
            savedBackupSchedule.intervalHours, savedBackupSchedule.isActive,
            savedBackupSchedule.lastRunAt ?? null, savedBackupSchedule.nextRunAt,
            savedBackupSchedule.createdBy, savedBackupSchedule.createdAt,
            savedBackupSchedule.updatedAt
          );
        }
      },
      { timeout: 300_000 } // 5 minutos para inventários grandes
    );

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

// Remove locks órfãos deixados por crashes ou reinicios do servidor
export async function clearStaleLocks() {
  const { count } = await prisma.systemLock.deleteMany({});
  if (count > 0) console.log(`🔓 ${count} lock(s) órfão(s) removido(s) na inicialização`);
}
