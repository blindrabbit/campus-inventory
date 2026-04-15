// backend/scripts/flush-database.js
// Zera todos os dados de inventário, mantendo apenas os usuários.
// Uso: node scripts/flush-database.js --confirm

import "dotenv/config";
import { prisma } from "../src/prisma/client.js";

const CONFIRMED = process.argv.includes("--confirm");

async function countAll() {
  const [inventories, inventoryUsers, inventoryStatusHistory, spaces, items,
         itemGroups, itemHistorico, relocations, verificationRolls, finalizationHistory] =
    await Promise.all([
      prisma.inventory.count(),
      prisma.inventoryUser.count(),
      prisma.inventoryStatusHistory.count(),
      prisma.space.count(),
      prisma.item.count(),
      prisma.itemGroup.count(),
      prisma.itemHistorico.count(),
      prisma.relocation.count(),
      prisma.verificationRoll.count(),
      prisma.finalizationHistory.count(),
    ]);

  return { inventories, inventoryUsers, inventoryStatusHistory, spaces, items,
           itemGroups, itemHistorico, relocations, verificationRolls, finalizationHistory };
}

async function run() {
  const before = await countAll();

  console.log("─── Estado atual ───────────────────────────────");
  for (const [k, v] of Object.entries(before)) {
    console.log(`  ${k.padEnd(28)}: ${v}`);
  }

  const total = Object.values(before).reduce((a, b) => a + b, 0);
  console.log(`\n  Total a remover: ${total} registro(s)`);
  console.log(`  Usuários:        ${await prisma.user.count()} (serão mantidos)`);

  if (!CONFIRMED) {
    console.log("\n⚠️  Nenhuma alteração feita.");
    console.log("   Para executar de verdade, use: npm run flush-database -- --confirm");
    return;
  }

  console.log("\n🗑️  Iniciando limpeza...\n");

  // Ordem respeita as dependências de FK (mais específico → mais geral)
  const steps = [
    ["itemHistorico",         () => prisma.itemHistorico.deleteMany()],
    ["relocations",           () => prisma.relocation.deleteMany()],
    ["verificationRolls",     () => prisma.verificationRoll.deleteMany()],
    ["finalizationHistory",   () => prisma.finalizationHistory.deleteMany()],
    ["items",                 () => prisma.item.deleteMany()],
    ["itemGroups",            () => prisma.itemGroup.deleteMany()],
    ["spaces",                () => prisma.space.deleteMany()],
    ["inventoryStatusHistory",() => prisma.inventoryStatusHistory.deleteMany()],
    ["inventoryUsers",        () => prisma.inventoryUser.deleteMany()],
    ["inventories",           () => prisma.inventory.deleteMany()],
  ];

  for (const [label, fn] of steps) {
    const result = await fn();
    console.log(`  ✓ ${label.padEnd(28)}: ${result.count} removido(s)`);
  }

  const after = await countAll();
  const remaining = Object.values(after).reduce((a, b) => a + b, 0);

  console.log("\n─── Estado final ───────────────────────────────");
  for (const [k, v] of Object.entries(after)) {
    console.log(`  ${k.padEnd(28)}: ${v}`);
  }
  console.log(`\n  Registros restantes de inventário: ${remaining}`);
  console.log(`  Usuários mantidos: ${await prisma.user.count()}`);

  if (remaining === 0) {
    console.log("\n✅ Base de dados zerada com sucesso.");
  } else {
    console.log("\n⚠️  Ainda há registros — verifique manualmente.");
  }
}

run()
  .catch((err) => {
    console.error("Erro fatal:", err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
