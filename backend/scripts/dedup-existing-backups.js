/**
 * dedup-existing-backups.js
 *
 * Aplica a regra de deduplicação retroativamente nos backups agendados existentes:
 *  - Lê cada arquivo SQL do disco
 *  - Calcula o hash (excluindo a linha de timestamp)
 *  - Agrupa por hash; dentro de cada grupo ordena por data (mais recente primeiro)
 *  - Mantém apenas o mais recente; apaga arquivo + registro dos demais
 *  - Atualiza dedupCount e contentHash no registro sobrevivente
 *
 * Uso (dentro do container ou com DATABASE_URL correto):
 *   node scripts/dedup-existing-backups.js
 */

import fs from "fs";
import path from "path";
import { createHash } from "crypto";
import { prisma } from "../src/prisma/client.js";

function hashSQL(content) {
  const normalized = content
    .split("\n")
    .filter((l) => !l.startsWith("-- Generated at:"))
    .join("\n");
  return createHash("sha256").update(normalized).digest("hex");
}

async function run() {
  console.log("=== Deduplicação de backups existentes ===\n");

  const records = await prisma.backupRecord.findMany({
    where: { isScheduled: true, status: "COMPLETED" },
    orderBy: { createdAt: "desc" },
  });

  console.log(`Backups agendados encontrados: ${records.length}\n`);

  // Calcula hash de cada arquivo
  const withHash = [];
  let unreadable = 0;

  for (const rec of records) {
    if (!fs.existsSync(rec.filePath)) {
      console.log(`  ⚠ Arquivo ausente (só registro): ${rec.id} — ${rec.filePath}`);
      unreadable++;
      continue;
    }
    const content = fs.readFileSync(rec.filePath, "utf8");
    const hash = hashSQL(content);
    withHash.push({ ...rec, hash });
  }

  console.log(`Arquivos lidos: ${withHash.length} | Ausentes: ${unreadable}\n`);

  // Agrupa por hash
  const groups = new Map();
  for (const rec of withHash) {
    if (!groups.has(rec.hash)) groups.set(rec.hash, []);
    groups.get(rec.hash).push(rec);
  }

  console.log(`Grupos de conteúdo único: ${groups.size}`);

  let totalRemovidos = 0;
  let totalMantidos = 0;

  for (const [hash, group] of groups) {
    // Já vem ordenado por createdAt desc — o [0] é o mais recente
    const [keeper, ...duplicates] = group;
    const dedupCount = duplicates.length;

    // Atualiza o sobrevivente com hash e contagem
    await prisma.backupRecord.update({
      where: { id: keeper.id },
      data: { contentHash: hash, dedupCount },
    });

    totalMantidos++;

    if (duplicates.length === 0) {
      console.log(`  ✓ Hash ${hash.slice(0, 12)}...: 1 backup único — nada a remover`);
      continue;
    }

    console.log(
      `  ✓ Hash ${hash.slice(0, 12)}...: mantendo ${keeper.id} (${new Date(keeper.createdAt).toLocaleString("pt-BR")}) | removendo ${duplicates.length} cópia(s)`
    );

    for (const dup of duplicates) {
      // Remove arquivo do disco
      try {
        fs.unlinkSync(dup.filePath);
        process.stdout.write(`    🗑 Arquivo removido: ${dup.filePath}\n`);
      } catch (e) {
        process.stdout.write(`    ⚠ Arquivo não encontrado no disco: ${dup.filePath}\n`);
      }

      // Remove registro do banco
      await prisma.backupRecord.delete({ where: { id: dup.id } });
      totalRemovidos++;
    }
  }

  // Registros sem arquivo em disco (sem hash) — limpa apenas o registro
  const orphans = records.filter((r) => !withHash.find((w) => w.id === r.id));
  if (orphans.length > 0) {
    console.log(`\n  Removendo ${orphans.length} registro(s) sem arquivo no disco:`);
    for (const orp of orphans) {
      await prisma.backupRecord.delete({ where: { id: orp.id } });
      console.log(`    🗑 Registro órfão removido: ${orp.id}`);
      totalRemovidos++;
    }
  }

  console.log(`\n--- Resultado ---`);
  console.log(`  Mantidos: ${totalMantidos}`);
  console.log(`  Removidos: ${totalRemovidos}`);
  if (records[0]?.filePath) {
    const dir = path.dirname(records[0].filePath);
    const remaining = fs.existsSync(dir) ? fs.readdirSync(dir).length : 0;
    console.log(`  Arquivos em disco agora: ${remaining}`);
  }
  console.log("\n✅ Deduplicação concluída.");
}

run()
  .catch((e) => { console.error("❌ Erro:", e.message); process.exit(1); })
  .finally(() => prisma.$disconnect());
