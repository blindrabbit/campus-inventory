// backend/scripts/sync-ad-fullnames.js
// Atualiza o fullName de todos os usuários buscando givenName + sn do Active Directory.
// Uso: node scripts/sync-ad-fullnames.js [--dry-run]

import "dotenv/config";
import { prisma } from "../src/prisma/client.js";
import { findDirectoryUserBySam } from "../src/services/ldap.js";

const DRY_RUN = process.argv.includes("--dry-run");

if (DRY_RUN) {
  console.log("🔍 Modo dry-run: nenhuma alteração será salva no banco.\n");
}

async function syncAdFullNames() {
  const users = await prisma.user.findMany({
    orderBy: { samAccountName: "asc" },
  });

  if (users.length === 0) {
    console.log("Nenhum usuário encontrado no banco.");
    return;
  }

  console.log(`Encontrados ${users.length} usuário(s). Consultando AD...\n`);

  const results = { updated: 0, unchanged: 0, notFound: 0, error: 0 };

  for (const user of users) {
    try {
      const adUser = await findDirectoryUserBySam(user.samAccountName);

      if (!adUser || !adUser.fullName) {
        console.warn(`  [NÃO ENCONTRADO] ${user.samAccountName}`);
        results.notFound++;
        continue;
      }

      const newFullName = adUser.fullName.trim();

      if (newFullName === user.fullName) {
        console.log(`  [SEM MUDANÇA]   ${user.samAccountName} → "${user.fullName}"`);
        results.unchanged++;
        continue;
      }

      console.log(
        `  [ATUALIZAR]     ${user.samAccountName}\n` +
        `                  antes:  "${user.fullName}"\n` +
        `                  depois: "${newFullName}"`
      );

      if (!DRY_RUN) {
        await prisma.user.update({
          where: { id: user.id },
          data: { fullName: newFullName },
        });
      }

      results.updated++;
    } catch (err) {
      console.error(`  [ERRO]          ${user.samAccountName}: ${err.message}`);
      results.error++;
    }
  }

  console.log("\n─────────────────────────────────────────");
  console.log(`Atualizados:     ${results.updated}`);
  console.log(`Sem mudança:     ${results.unchanged}`);
  console.log(`Não encontrados: ${results.notFound}`);
  console.log(`Erros:           ${results.error}`);
  if (DRY_RUN) {
    console.log("\n⚠️  Dry-run: nenhum dado foi salvo.");
  }
}

syncAdFullNames()
  .catch((err) => {
    console.error("Erro fatal:", err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
