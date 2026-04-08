// backend/scripts/promote-admin.js
import { prisma } from '../src/prisma/client.js';

const USER_IDENTIFIER = process.argv[2]; // Ex: node promote-admin.js 1918648

if (!USER_IDENTIFIER) {
  console.error('Uso: node scripts/promote-admin.js <samAccountName ou ID>');
  process.exit(1);
}

async function promoteAdmin() {
  try {
    // Tenta buscar por samAccountName (matrícula) ou por ID
    const user = await prisma.user.findFirst({
      where: {
        OR: [
          { samAccountName: USER_IDENTIFIER },
          { id: USER_IDENTIFIER }
        ]
      }
    });

    if (!user) {
      console.error(`❌ Usuário "${USER_IDENTIFIER}" não encontrado.`);
      console.log('💡 Dica: O usuário precisa fazer login pelo menos uma vez para ser criado no banco.');
      process.exit(1);
    }

    await prisma.user.update({
      where: { id: user.id },
      data: { role: 'ADMIN' }
    });

    console.log(`✅ Usuário "${user.fullName}" (${user.samAccountName}) promovido a ADMIN!`);
  } catch (err) {
    console.error('❌ Erro ao promover usuário:', err);
    process.exit(1);
  } finally {
    await prisma.$disconnect();
  }
}

promoteAdmin();