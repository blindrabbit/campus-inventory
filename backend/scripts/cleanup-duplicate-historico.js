import { prisma } from "../src/prisma/client.js";

async function main() {
  const allRecords = await prisma.itemHistorico.findMany({
    orderBy: { createdAt: "asc" },
    include: { item: { select: { patrimonio: true } } },
  });

  console.log(`Total de registros: ${allRecords.length}`);

  // Group by itemId
  const byItem = new Map();
  for (const record of allRecords) {
    if (!byItem.has(record.itemId)) byItem.set(record.itemId, []);
    byItem.get(record.itemId).push(record);
  }

  const toDelete = [];

  for (const [itemId, records] of byItem.entries()) {
    // Sort by createdAt ascending (already sorted, but ensure)
    records.sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt));

    const kept = new Set();
    const dupes = [];

    for (const record of records) {
      // Find a "parent" record: same action + same createdBy within 2 seconds
      const parentKey = `${record.action}|${record.createdBy}`;
      let isDupe = false;

      for (const keptId of kept) {
        const keptRecord = records.find((r) => r.id === keptId);
        if (!keptRecord) continue;
        if (
          keptRecord.action === record.action &&
          keptRecord.createdBy === record.createdBy &&
          Math.abs(new Date(record.createdAt) - new Date(keptRecord.createdAt)) <= 2000
        ) {
          isDupe = true;
          break;
        }
      }

      if (isDupe) {
        dupes.push(record);
      } else {
        kept.add(record.id);
      }
    }

    if (dupes.length > 0) {
      const patrimonio = records[0]?.item?.patrimonio ?? itemId;
      console.log(`  Item #${patrimonio} (${itemId}): ${dupes.length} duplicata(s) a remover`);
      toDelete.push(...dupes.map((r) => r.id));
    }
  }

  console.log(`\nTotal a remover: ${toDelete.length}`);

  if (toDelete.length === 0) {
    console.log("Nenhum registro duplicado encontrado.");
    return;
  }

  const { count } = await prisma.itemHistorico.deleteMany({
    where: { id: { in: toDelete } },
  });

  console.log(`\n✅ ${count} registros duplicados removidos com sucesso.`);
}

main()
  .catch((err) => { console.error(err); process.exit(1); })
  .finally(() => prisma.$disconnect());
