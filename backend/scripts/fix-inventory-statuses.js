/**
 * One-time fix: promote inventories from NAO_INICIADO to EM_EXECUCAO
 * when they already have at least one space with startedAt set.
 *
 * Run: node scripts/fix-inventory-statuses.js
 */
import { prisma } from "../src/prisma/client.js";

const startedSpaces = await prisma.space.findMany({
  where: { startedAt: { not: null } },
  select: { inventoryId: true },
  distinct: ["inventoryId"],
});

const activeInventoryIds = [...new Set(startedSpaces.map((s) => s.inventoryId))];

if (activeInventoryIds.length === 0) {
  console.log("Nenhum inventário com salas iniciadas encontrado.");
  await prisma.$disconnect();
  process.exit(0);
}

const result = await prisma.inventory.updateMany({
  where: {
    id: { in: activeInventoryIds },
    statusOperacao: "NAO_INICIADO",
  },
  data: { statusOperacao: "EM_EXECUCAO" },
});

console.log(`${result.count} inventário(s) atualizados para "Iniciado".`);
await prisma.$disconnect();
