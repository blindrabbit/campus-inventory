/**
 * migrate-sqlite-to-pg.js
 *
 * Importa o dump JSON do SQLite para o PostgreSQL usando o Prisma Client.
 * Execute APÓS gerar /tmp/sqlite_dump.json com o script Python.
 *
 * Uso:
 *   node scripts/migrate-sqlite-to-pg.js
 */

import { readFileSync } from "fs";
import { prisma } from "../src/prisma/client.js";

const DUMP_PATH = "/tmp/sqlite_dump.json";
const BATCH = 500;

function progress(label, count) {
  process.stdout.write(`  ✓ ${label}: ${count} registros\n`);
}

function toDate(v) {
  if (!v) return null;
  const d = new Date(v);
  return isNaN(d.getTime()) ? null : d;
}

// Normaliza tipos do SQLite para o formato esperado pelo Prisma PG
function normalizeUser(r) {
  return {
    id: r.id, samAccountName: r.samAccountName, fullName: r.fullName,
    role: r.role,
    createdAt: toDate(r.createdAt), updatedAt: toDate(r.updatedAt),
  };
}

function normalizeInventory(r, nullifyBase = false) {
  return {
    id: r.id, name: r.name, campus: r.campus, sourceType: r.sourceType,
    statusOperacao: r.statusOperacao,
    baseInventoryId: nullifyBase ? null : r.baseInventoryId,
    createdById: r.createdById,
    startedAt: toDate(r.startedAt), finishedAt: toDate(r.finishedAt),
    createdAt: toDate(r.createdAt), updatedAt: toDate(r.updatedAt),
  };
}

function normalizeInventoryUser(r) {
  return {
    id: r.id, inventoryId: r.inventoryId, userId: r.userId, role: r.role,
    createdAt: toDate(r.createdAt), updatedAt: toDate(r.updatedAt),
  };
}

function normalizeStatusHistory(r) {
  return {
    id: r.id, inventoryId: r.inventoryId, fromStatus: r.fromStatus,
    toStatus: r.toStatus, changedBy: r.changedBy, changedAt: toDate(r.changedAt),
  };
}

function normalizeItemGroup(r) {
  return {
    id: r.id, inventoryId: r.inventoryId, name: r.name,
    description: r.description,
    createdAt: toDate(r.createdAt), updatedAt: toDate(r.updatedAt),
  };
}

function normalizeSpace(r) {
  return {
    id: r.id, name: r.name, responsible: r.responsible,
    sector: r.sector, unit: r.unit, inventoryId: r.inventoryId,
    isActive: Boolean(r.isActive), isFinalized: Boolean(r.isFinalized),
    isVerifiedByRevisor: Boolean(r.isVerifiedByRevisor ?? false),
    startedAt: toDate(r.startedAt), startedBy: r.startedBy,
    observacoes: r.observacoes ?? null,
    createdAt: toDate(r.createdAt), updatedAt: toDate(r.updatedAt),
  };
}

function normalizeItem(r) {
  return {
    id: r.id, patrimonio: r.patrimonio, descricao: r.descricao,
    valor: r.valor ?? null,
    condicaoOriginal: r.condicaoOriginal,
    fornecedor: r.fornecedor ?? null,
    cnpjFornecedor: r.cnpj_fornecedor ?? null,
    catalogo: r.catalogo ?? null,
    codigoSIA: r.codigo_sia ?? null,
    descricaoSIA: r.descricao_sia ?? null,
    numeroEntrada: r.numero_entrada ?? null,
    dataEntrada: toDate(r.data_entrada),
    dataAquisicao: toDate(r.data_aquisicao),
    documento: r.documento ?? null,
    dataDocumento: toDate(r.data_documento),
    tipoAquisicao: r.tipo_aquisicao ?? null,
    inventoryId: r.inventoryId ?? null,
    spaceId: r.spaceId,
    lastKnownSpaceId: r.lastKnownSpaceId ?? null,
    statusEncontrado: r.Encontrado ?? "NAO",
    condicaoVisual: r.condicaoVisual ?? null,
    dataConferencia: toDate(r.dataConferencia),
    ultimoConferente: r.ultimoConferente ?? null,
    verificationStatus: r.verificationStatus ?? null,
    verifiedAt: toDate(r.verifiedAt),
    verifiedBy: r.verifiedBy ?? null,
    itemGroupId: r.itemGroupId ?? null,
    createdAt: toDate(r.createdAt), updatedAt: toDate(r.updatedAt),
  };
}

function normalizeItemHistory(r) {
  return {
    id: r.id, itemId: r.itemId,
    fromSpaceId: r.fromSpaceId ?? null, toSpaceId: r.toSpaceId ?? null,
    action: r.action, reason: r.reason ?? null,
    createdBy: r.createdBy, metadata: r.metadata ?? null,
    createdAt: toDate(r.createdAt),
  };
}

function normalizeRelocation(r) {
  return {
    id: r.id, itemId: r.itemId,
    fromSpaceId: r.fromSpaceId, toSpaceId: r.toSpaceId,
    movedBy: r.movedBy, movedAt: toDate(r.movedAt),
    pendingConfirm: Boolean(r.pendingConfirm),
    wasUnfound: Boolean(r.wasUnfound ?? false),
  };
}

function normalizeVerificationRoll(r) {
  return {
    id: r.id, spaceId: r.spaceId, itemIds: r.itemIds ?? "[]",
    selectedAt: toDate(r.selectedAt), reviewedAt: toDate(r.reviewedAt),
    result: r.result ?? "PENDING", reason: r.reason ?? null,
    createdBy: r.createdBy, updatedAt: toDate(r.updatedAt),
  };
}

function normalizeFinalizationHistory(r) {
  return {
    id: r.id, spaceId: r.spaceId, action: r.action,
    reason: r.reason ?? null, actedBy: r.actedBy, actedAt: toDate(r.actedAt),
  };
}

function normalizeBackupRecord(r) {
  return {
    id: r.id, inventoryId: r.inventoryId, createdBy: r.createdBy,
    createdAt: toDate(r.createdAt), label: r.label ?? null,
    fileName: r.fileName, filePath: r.filePath,
    fileSizeBytes: r.fileSizeBytes ?? 0,
    status: r.status ?? "COMPLETED",
    errorMessage: r.errorMessage ?? null,
    isScheduled: Boolean(r.isScheduled ?? false),
  };
}

function normalizeBackupSchedule(r) {
  return {
    id: r.id, inventoryId: r.inventoryId,
    intervalHours: r.intervalHours, isActive: Boolean(r.isActive ?? true),
    lastRunAt: toDate(r.lastRunAt), nextRunAt: toDate(r.nextRunAt),
    createdBy: r.createdBy,
    createdAt: toDate(r.createdAt), updatedAt: toDate(r.updatedAt),
  };
}

async function insertBatches(label, rows, normFn, insertFn) {
  if (rows.length === 0) {
    process.stdout.write(`  ~ ${label}: vazio\n`);
    return;
  }
  const normalized = rows.map(normFn);
  for (let i = 0; i < normalized.length; i += BATCH) {
    await insertFn(normalized.slice(i, i + BATCH));
  }
  progress(label, rows.length);
}

async function run() {
  console.log("=== Importação SQLite → PostgreSQL ===\n");

  const dump = JSON.parse(readFileSync(DUMP_PATH, "utf-8"));

  console.log("--- Limpando PostgreSQL (ordem reversa FK) ---");
  await prisma.$executeRawUnsafe(`TRUNCATE TABLE
    finalization_history, verification_rolls, item_history, relocations,
    items, item_groups, spaces, inventory_status_history, inventory_users,
    backup_records, backup_schedules, system_locks, inventories, users
    CASCADE`);
  console.log("  ✓ Tabelas limpas\n");

  console.log("--- Inserindo dados ---");

  // 1. users
  await insertBatches("users", dump.users, normalizeUser, (data) =>
    prisma.user.createMany({ data, skipDuplicates: true })
  );

  // 2. inventories — sem baseInventoryId (auto-referência)
  if (dump.inventories.length > 0) {
    const normalized = dump.inventories.map((r) => normalizeInventory(r, true));
    for (let i = 0; i < normalized.length; i += BATCH) {
      await prisma.inventory.createMany({ data: normalized.slice(i, i + BATCH), skipDuplicates: true });
    }
    // Atualizar baseInventoryId onde existir
    for (const r of dump.inventories.filter((r) => r.baseInventoryId)) {
      await prisma.inventory.update({
        where: { id: r.id },
        data: { baseInventoryId: r.baseInventoryId },
      });
    }
    progress("inventories", dump.inventories.length);
  }

  // 3. inventory_users
  await insertBatches("inventory_users", dump.inventory_users, normalizeInventoryUser, (data) =>
    prisma.inventoryUser.createMany({ data, skipDuplicates: true })
  );

  // 4. inventory_status_history
  await insertBatches("inventory_status_history", dump.inventory_status_history, normalizeStatusHistory, (data) =>
    prisma.inventoryStatusHistory.createMany({ data, skipDuplicates: true })
  );

  // 5. item_groups
  await insertBatches("item_groups", dump.item_groups, normalizeItemGroup, (data) =>
    prisma.itemGroup.createMany({ data, skipDuplicates: true })
  );

  // 6. spaces
  await insertBatches("spaces", dump.spaces, normalizeSpace, (data) =>
    prisma.space.createMany({ data, skipDuplicates: true })
  );

  // 7. items
  await insertBatches("items", dump.items, normalizeItem, (data) =>
    prisma.item.createMany({ data, skipDuplicates: true })
  );

  // 8. item_history
  await insertBatches("item_history", dump.item_history, normalizeItemHistory, (data) =>
    prisma.itemHistorico.createMany({ data, skipDuplicates: true })
  );

  // 9. relocations
  await insertBatches("relocations", dump.relocations, normalizeRelocation, (data) =>
    prisma.relocation.createMany({ data, skipDuplicates: true })
  );

  // 10. verification_rolls
  await insertBatches("verification_rolls", dump.verification_rolls, normalizeVerificationRoll, (data) =>
    prisma.verificationRoll.createMany({ data, skipDuplicates: true })
  );

  // 11. finalization_history
  await insertBatches("finalization_history", dump.finalization_history, normalizeFinalizationHistory, (data) =>
    prisma.finalizationHistory.createMany({ data, skipDuplicates: true })
  );

  // 12. backup_records
  await insertBatches("backup_records", dump.backup_records, normalizeBackupRecord, (data) =>
    prisma.backupRecord.createMany({ data, skipDuplicates: true })
  );

  // 13. backup_schedules
  await insertBatches("backup_schedules", dump.backup_schedules, normalizeBackupSchedule, (data) =>
    prisma.backupSchedule.createMany({ data, skipDuplicates: true })
  );

  // 14. system_locks (normalmente vazio)
  await insertBatches("system_locks", dump.system_locks ?? [], (r) => r, (data) =>
    prisma.systemLock.createMany({ data, skipDuplicates: true })
  );

  // ─── Validação ───
  console.log("\n--- Validação de contagens ---");
  const checks = [
    ["users",               () => prisma.user.count(),                    dump.users.length],
    ["inventories",         () => prisma.inventory.count(),               dump.inventories.length],
    ["inventory_users",     () => prisma.inventoryUser.count(),           dump.inventory_users.length],
    ["spaces",              () => prisma.space.count(),                   dump.spaces.length],
    ["items",               () => prisma.item.count(),                    dump.items.length],
    ["item_history",        () => prisma.itemHistorico.count(),           dump.item_history.length],
    ["relocations",         () => prisma.relocation.count(),              dump.relocations.length],
    ["verification_rolls",  () => prisma.verificationRoll.count(),        dump.verification_rolls.length],
    ["finalization_history",() => prisma.finalizationHistory.count(),     dump.finalization_history.length],
    ["backup_records",      () => prisma.backupRecord.count(),            dump.backup_records.length],
  ];

  let allOk = true;
  for (const [label, countFn, expected] of checks) {
    const got = await countFn();
    const ok = got === expected;
    if (!ok) allOk = false;
    console.log(`  ${ok ? "✓" : "✗"} ${label}: esperado=${expected} | PG=${got}${ok ? "" : " ⚠ DIVERGÊNCIA"}`);
  }

  if (allOk) {
    console.log("\n✅ Migração validada com sucesso!");
  } else {
    console.log("\n⚠ Há divergências — verifique os itens marcados com ✗");
    process.exit(1);
  }
}

run()
  .catch((err) => {
    console.error("\n❌ Erro fatal:", err.message, err.stack);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
