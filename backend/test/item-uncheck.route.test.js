import test from "node:test";
import assert from "node:assert/strict";
import router from "../src/routes/item.routes.js";
import { prisma } from "../src/prisma/client.js";

function getPostRouteHandler(path) {
  const layer = router.stack.find(
    (entry) => entry.route?.path === path && entry.route?.methods?.post,
  );

  assert.ok(layer, `Route ${path} nao encontrada`);
  return layer.route.stack[layer.route.stack.length - 1].handle;
}

function createMockResponse() {
  return {
    statusCode: 200,
    body: null,
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(payload) {
      this.body = payload;
      return this;
    },
  };
}

test("POST /uncheck retorna 404 quando item nao existe no inventario", async () => {
  const handler = getPostRouteHandler("/uncheck");

  const originalFindUnique = prisma.item.findUnique;
  const originalUpdateMany = prisma.item.updateMany;

  prisma.item.findUnique = async () => null;
  prisma.item.updateMany = async () => {
    throw new Error("Nao deveria atualizar quando item nao existe");
  };

  try {
    const req = {
      body: { itemId: "item-1" },
      inventoryId: "inv-1",
      user: { sub: "tester" },
    };
    const res = createMockResponse();

    await handler(req, res);

    assert.equal(res.statusCode, 404);
    assert.deepEqual(res.body, { error: "Item não encontrado" });
  } finally {
    prisma.item.findUnique = originalFindUnique;
    prisma.item.updateMany = originalUpdateMany;
  }
});

test("POST /uncheck retorna 400 quando item nao esta encontrado", async () => {
  const handler = getPostRouteHandler("/uncheck");

  const originalFindUnique = prisma.item.findUnique;
  const originalUpdateMany = prisma.item.updateMany;

  prisma.item.findUnique = async () => ({
    id: "item-1",
    spaceId: "space-1",
    inventoryId: "inv-1",
    statusEncontrado: "PENDENTE",
  });
  prisma.item.updateMany = async () => {
    throw new Error("Nao deveria atualizar quando status nao e SIM");
  };

  try {
    const req = {
      body: { itemId: "item-1" },
      inventoryId: "inv-1",
      user: { sub: "tester" },
    };
    const res = createMockResponse();

    await handler(req, res);

    assert.equal(res.statusCode, 400);
    assert.deepEqual(res.body, {
      error: "Somente itens marcados como encontrados podem ser desfeitos",
    });
  } finally {
    prisma.item.findUnique = originalFindUnique;
    prisma.item.updateMany = originalUpdateMany;
  }
});

test("POST /uncheck desfaz encontrado e registra historico", async () => {
  const handler = getPostRouteHandler("/uncheck");

  const originalFindUnique = prisma.item.findUnique;
  const originalUpdateMany = prisma.item.updateMany;
  const originalCreateHistory = prisma.itemHistorico.create;

  let updatePayload = null;
  let historyPayload = null;

  prisma.item.findUnique = async () => ({
    id: "item-1",
    spaceId: "space-1",
    inventoryId: "inv-1",
    statusEncontrado: "SIM",
  });
  prisma.item.updateMany = async (payload) => {
    updatePayload = payload;
    return { count: 1 };
  };
  prisma.itemHistorico.create = async (payload) => {
    historyPayload = payload;
    return { id: "hist-1", ...payload.data };
  };

  try {
    const req = {
      body: { itemId: "item-1" },
      inventoryId: "inv-1",
      user: { sub: "tester" },
    };
    const res = createMockResponse();

    await handler(req, res);

    assert.equal(res.statusCode, 200);
    assert.deepEqual(res.body, { success: true });

    assert.deepEqual(updatePayload, {
      where: { id: "item-1", inventoryId: "inv-1" },
      data: {
        statusEncontrado: "PENDENTE",
        condicaoVisual: null,
        dataConferencia: null,
        ultimoConferente: null,
      },
    });

    assert.ok(historyPayload);
    assert.equal(historyPayload.data.itemId, "item-1");
    assert.equal(historyPayload.data.fromSpaceId, "space-1");
    assert.equal(historyPayload.data.toSpaceId, "space-1");
    assert.equal(historyPayload.data.action, "DESFEITO_ENCONTRADO");
    assert.equal(historyPayload.data.createdBy, "tester");
  } finally {
    prisma.item.findUnique = originalFindUnique;
    prisma.item.updateMany = originalUpdateMany;
    prisma.itemHistorico.create = originalCreateHistory;
  }
});
