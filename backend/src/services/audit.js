export async function recordItemHistory(prisma, data) {
  return prisma.itemHistorico.create({
    data: {
      ...data,
      metadata:
        data.metadata === undefined || data.metadata === null
          ? null
          : typeof data.metadata === "string"
            ? data.metadata
            : JSON.stringify(data.metadata),
    },
  });
}
