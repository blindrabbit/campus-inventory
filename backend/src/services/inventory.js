import { prisma } from "../prisma/client.js";

export async function findUserBySamAccountName(samAccountName) {
  if (!samAccountName) return null;

  return prisma.user.findUnique({
    where: { samAccountName },
  });
}

export async function getOrCreateDefaultInventory(createdById = null) {
  const existing = await prisma.inventory.findFirst({
    orderBy: { createdAt: "asc" },
  });

  if (existing) return existing;

  return prisma.inventory.create({
    data: {
      name: "Inventario Inicial",
      campus: "Campus Aracruz",
      sourceType: "UPLOAD_XLSX",
      statusOperacao: "NAO_INICIADO",
      createdById,
    },
  });
}

export async function ensureInventoryBootstrapForUser(user) {
  const defaultInventory = await getOrCreateDefaultInventory(user?.id || null);

  // Backfill de dados legados para manter compatibilidade ao ativar ciclos.
  await prisma.space.updateMany({
    where: { inventoryId: null },
    data: { inventoryId: defaultInventory.id },
  });

  await prisma.item.updateMany({
    where: { inventoryId: null },
    data: { inventoryId: defaultInventory.id },
  });

  if (user?.id) {
    await prisma.inventoryUser.upsert({
      where: {
        inventoryId_userId: {
          inventoryId: defaultInventory.id,
          userId: user.id,
        },
      },
      create: {
        inventoryId: defaultInventory.id,
        userId: user.id,
        role: user.role === "ADMIN" ? "ADMIN_CICLO" : "CONFERENTE",
      },
      update: {
        role: user.role === "ADMIN" ? "ADMIN_CICLO" : undefined,
      },
    });
  }

  return defaultInventory;
}

export async function resolveInventoryAccess({ inventoryId, samAccountName }) {
  const user = await findUserBySamAccountName(samAccountName);
  if (!user) return { user: null, access: null };

  if (user.role === "ADMIN") {
    return {
      user,
      access: {
        inventoryId,
        role: "ADMIN_CICLO",
      },
    };
  }

  const access = await prisma.inventoryUser.findUnique({
    where: {
      inventoryId_userId: {
        inventoryId,
        userId: user.id,
      },
    },
  });

  return { user, access };
}
