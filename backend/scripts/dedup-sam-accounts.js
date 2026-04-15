// backend/scripts/dedup-sam-accounts.js
// Remove duplicatas de samAccountName (case-insensitive) e normaliza todos para minúsculas.
// Uso: node scripts/dedup-sam-accounts.js [--dry-run]

import "dotenv/config";
import { prisma } from "../src/prisma/client.js";

const DRY_RUN = process.argv.includes("--dry-run");

if (DRY_RUN) {
  console.log("🔍 Modo dry-run: nenhuma alteração será salva.\n");
}

async function run() {
  const all = await prisma.user.findMany({
    include: { inventoryLinks: true },
    orderBy: { createdAt: "asc" },
  });

  // ── 1. Encontrar grupos duplicados ───────────────────────────────────────
  const groups = new Map();
  for (const u of all) {
    const key = u.samAccountName.toLowerCase();
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(u);
  }

  const duplicates = [...groups.entries()].filter(([, list]) => list.length > 1);

  if (duplicates.length === 0) {
    console.log("Nenhuma duplicata de samAccountName encontrada.");
  } else {
    console.log(`Duplicatas encontradas: ${duplicates.length}\n`);

    for (const [key, list] of duplicates) {
      // Keeper: o que tiver mais vínculos; em empate, o mais antigo (primeiro)
      list.sort((a, b) => b.inventoryLinks.length - a.inventoryLinks.length);
      const keeper = list[0];
      const removals = list.slice(1);

      console.log(`  Mantendo:  "${keeper.samAccountName}" (${keeper.id}) — ${keeper.inventoryLinks.length} vínculo(s)`);

      for (const dup of removals) {
        console.log(`  Removendo: "${dup.samAccountName}" (${dup.id}) — ${dup.inventoryLinks.length} vínculo(s)`);

        // Migrar vínculos que o keeper ainda não possui
        for (const link of dup.inventoryLinks) {
          const alreadyExists = keeper.inventoryLinks.some(
            (l) => l.inventoryId === link.inventoryId,
          );

          if (alreadyExists) {
            console.log(`    Vínculo "${link.inventoryId}" ignorado (já existe no keeper)`);
          } else {
            console.log(`    Migrando vínculo "${link.inventoryId}" (${link.role}) → keeper`);
            if (!DRY_RUN) {
              await prisma.inventoryUser.update({
                where: { id: link.id },
                data: { userId: keeper.id },
              });
            }
          }
        }

        // Deletar o duplicado (vínculos não migrados são removidos em cascata)
        console.log(`    Deletando usuário duplicado "${dup.samAccountName}"`);
        if (!DRY_RUN) {
          await prisma.user.delete({ where: { id: dup.id } });
        }
      }
      console.log();
    }
  }

  // ── 2. Normalizar todos os samAccountName para minúsculas ────────────────
  console.log("Verificando samAccountNames com letras maiúsculas...");

  const toNormalize = all.filter(
    (u) => u.samAccountName !== u.samAccountName.toLowerCase(),
  );

  // Excluir os já deletados acima
  const deletedIds = new Set(
    duplicates.flatMap(([, list]) => list.slice(1).map((u) => u.id)),
  );
  const pending = toNormalize.filter((u) => !deletedIds.has(u.id));

  if (pending.length === 0) {
    console.log("  Todos já estão em minúsculas.\n");
  } else {
    for (const u of pending) {
      const normalized = u.samAccountName.toLowerCase();
      console.log(`  Normalizando "${u.samAccountName}" → "${normalized}"`);
      if (!DRY_RUN) {
        await prisma.user.update({
          where: { id: u.id },
          data: { samAccountName: normalized },
        });
      }
    }
    console.log();
  }

  if (DRY_RUN) {
    console.log("⚠️  Dry-run: nenhum dado foi salvo.");
  } else {
    console.log("✅ Concluído.");
  }
}

run()
  .catch((err) => {
    console.error("Erro fatal:", err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
