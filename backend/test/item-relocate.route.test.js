import test from "node:test";
import assert from "node:assert/strict";
import router from "../src/routes/item.routes.js";
import { prisma } from "../src/prisma/client.js";

function getRouteHandler(path, method = "post") {
  const layer = router.stack.find(
    (entry) =>
      entry.route?.path === path && entry.route?.methods?.[method],
  );
  assert.ok(layer, `Route ${method.toUpperCase()} ${path} não encontrada`);
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

// ────────────────────────────────────────────────────────────────────────────
// GET / — meta.wasUnfound
// ────────────────────────────────────────────────────────────────────────────

test("GET / inclui meta.wasUnfound=true quando item foi NAO antes de ser movido", async () => {
  const handler = getRouteHandler("/", "get");

  const originalFindMany = prisma.item.findMany;

  prisma.item.findMany = async () => [
    {
      id: "item-1",
      patrimonio: "12345",
      descricao: "Mesa",
      condicaoOriginal: "EXCELENTE",
      valor: null,
      codigoSIA: null,
      fornecedor: null,
      dataAquisicao: null,
      documento: null,
      statusEncontrado: "PENDENTE",
      condicaoVisual: null,
      dataConferencia: null,
      ultimoConferente: null,
      verificationStatus: null,
      verifiedAt: null,
      verifiedBy: null,
      itemGroup: null,
      relocationIn: {
        fromSpace: { name: "Sala 101" },
        movedBy: "user1",
        pendingConfirm: true,
        wasUnfound: true,
      },
    },
  ];

  try {
    const req = {
      query: { spaceId: "space-1" },
      inventoryId: "inv-1",
    };
    const res = createMockResponse();

    await handler(req, res);

    assert.equal(res.statusCode, 200);
    assert.equal(res.body.length, 1);
    assert.deepEqual(res.body[0].meta, {
      isRelocated: true,
      fromSpaceName: "Sala 101",
      movedBy: "user1",
      pendingConfirm: true,
      wasUnfound: true,
    });
  } finally {
    prisma.item.findMany = originalFindMany;
  }
});

test("GET / inclui meta.wasUnfound=false quando item foi movido sem estar NAO", async () => {
  const handler = getRouteHandler("/", "get");

  const originalFindMany = prisma.item.findMany;

  prisma.item.findMany = async () => [
    {
      id: "item-2",
      patrimonio: "99999",
      descricao: "Cadeira",
      condicaoOriginal: "EXCELENTE",
      valor: null,
      codigoSIA: null,
      fornecedor: null,
      dataAquisicao: null,
      documento: null,
      statusEncontrado: "PENDENTE",
      condicaoVisual: null,
      dataConferencia: null,
      ultimoConferente: null,
      verificationStatus: null,
      verifiedAt: null,
      verifiedBy: null,
      itemGroup: null,
      relocationIn: {
        fromSpace: { name: "Sala 202" },
        movedBy: "user2",
        pendingConfirm: true,
        wasUnfound: false,
      },
    },
  ];

  try {
    const req = {
      query: { spaceId: "space-2" },
      inventoryId: "inv-1",
    };
    const res = createMockResponse();

    await handler(req, res);

    assert.equal(res.statusCode, 200);
    assert.equal(res.body[0].meta.wasUnfound, false);
    assert.equal(res.body[0].meta.isRelocated, true);
  } finally {
    prisma.item.findMany = originalFindMany;
  }
});

test("GET / retorna meta=null quando item nao tem relocationIn", async () => {
  const handler = getRouteHandler("/", "get");

  const originalFindMany = prisma.item.findMany;

  prisma.item.findMany = async () => [
    {
      id: "item-3",
      patrimonio: "11111",
      descricao: "Armário",
      condicaoOriginal: "BOM",
      valor: null,
      codigoSIA: null,
      fornecedor: null,
      dataAquisicao: null,
      documento: null,
      statusEncontrado: "SIM",
      condicaoVisual: "BOM",
      dataConferencia: new Date(),
      ultimoConferente: "tester",
      verificationStatus: null,
      verifiedAt: null,
      verifiedBy: null,
      itemGroup: null,
      relocationIn: null,
    },
  ];

  try {
    const req = {
      query: { spaceId: "space-1" },
      inventoryId: "inv-1",
    };
    const res = createMockResponse();

    await handler(req, res);

    assert.equal(res.statusCode, 200);
    assert.equal(res.body[0].meta, null);
  } finally {
    prisma.item.findMany = originalFindMany;
  }
});

// ────────────────────────────────────────────────────────────────────────────
// POST /relocate — wasUnfound e ausência de markSpaceStarted
// ────────────────────────────────────────────────────────────────────────────

test("POST /relocate define wasUnfound=true quando item tem statusEncontrado NAO", async () => {
  const handler = getRouteHandler("/relocate");

  const origFindUnique = prisma.item.findUnique;
  const origFindFirst = prisma.space.findFirst;
  const origTransaction = prisma.$transaction;
  const origItemUpdate = prisma.item.updateMany;
  const origRelocationUpsert = prisma.relocation.upsert;
  const origHistorico = prisma.itemHistorico.create;
  const origSpaceUpdate = prisma.space.updateMany;

  let relocationPayload = null;
  let spaceUpdateCalled = false;

  prisma.item.findUnique = async () => ({
    id: "item-1",
    spaceId: "space-1",
    lastKnownSpaceId: null,
    inventoryId: "inv-1",
    statusEncontrado: "NAO",
  });
  prisma.space.findFirst = async () => ({ id: "space-2" });
  prisma.$transaction = async (callback) => callback(prisma);
  prisma.item.updateMany = async () => ({ count: 1 });
  prisma.relocation.upsert = async (payload) => {
    relocationPayload = payload;
    return {};
  };
  prisma.itemHistorico.create = async () => ({});
  prisma.space.updateMany = async () => {
    spaceUpdateCalled = true;
    return { count: 0 };
  };

  try {
    const req = {
      body: { itemId: "item-1", targetSpaceId: "space-2" },
      inventoryId: "inv-1",
      user: { sub: "tester", fullName: "Tester" },
    };
    const res = createMockResponse();

    await handler(req, res);

    assert.equal(res.statusCode, 200);
    assert.ok(relocationPayload, "relocation.upsert deve ter sido chamado");
    assert.equal(
      relocationPayload.create.wasUnfound,
      true,
      "wasUnfound deve ser true no create",
    );
    assert.equal(
      relocationPayload.update.wasUnfound,
      true,
      "wasUnfound deve ser true no update",
    );
    assert.equal(
      spaceUpdateCalled,
      false,
      "markSpaceStarted NÃO deve ser chamado ao mover item",
    );
  } finally {
    prisma.item.findUnique = origFindUnique;
    prisma.space.findFirst = origFindFirst;
    prisma.$transaction = origTransaction;
    prisma.item.updateMany = origItemUpdate;
    prisma.relocation.upsert = origRelocationUpsert;
    prisma.itemHistorico.create = origHistorico;
    prisma.space.updateMany = origSpaceUpdate;
  }
});

test("POST /relocate define wasUnfound=false quando item tem statusEncontrado PENDENTE", async () => {
  const handler = getRouteHandler("/relocate");

  const origFindUnique = prisma.item.findUnique;
  const origFindFirst = prisma.space.findFirst;
  const origTransaction = prisma.$transaction;
  const origItemUpdate = prisma.item.updateMany;
  const origRelocationUpsert = prisma.relocation.upsert;
  const origHistorico = prisma.itemHistorico.create;
  const origSpaceUpdate = prisma.space.updateMany;

  let relocationPayload = null;
  let spaceUpdateCalled = false;

  prisma.item.findUnique = async () => ({
    id: "item-2",
    spaceId: "space-1",
    lastKnownSpaceId: null,
    inventoryId: "inv-1",
    statusEncontrado: "PENDENTE",
  });
  prisma.space.findFirst = async () => ({ id: "space-2" });
  prisma.$transaction = async (callback) => callback(prisma);
  prisma.item.updateMany = async () => ({ count: 1 });
  prisma.relocation.upsert = async (payload) => {
    relocationPayload = payload;
    return {};
  };
  prisma.itemHistorico.create = async () => ({});
  prisma.space.updateMany = async () => {
    spaceUpdateCalled = true;
    return { count: 0 };
  };

  try {
    const req = {
      body: { itemId: "item-2", targetSpaceId: "space-2" },
      inventoryId: "inv-1",
      user: { sub: "tester", fullName: "Tester" },
    };
    const res = createMockResponse();

    await handler(req, res);

    assert.equal(res.statusCode, 200);
    assert.equal(relocationPayload.create.wasUnfound, false);
    assert.equal(relocationPayload.update.wasUnfound, false);
    assert.equal(spaceUpdateCalled, false);
  } finally {
    prisma.item.findUnique = origFindUnique;
    prisma.space.findFirst = origFindFirst;
    prisma.$transaction = origTransaction;
    prisma.item.updateMany = origItemUpdate;
    prisma.relocation.upsert = origRelocationUpsert;
    prisma.itemHistorico.create = origHistorico;
    prisma.space.updateMany = origSpaceUpdate;
  }
});

test("POST /relocate retorna 404 quando item nao existe no inventario", async () => {
  const handler = getRouteHandler("/relocate");

  const origFindUnique = prisma.item.findUnique;

  prisma.item.findUnique = async () => null;

  try {
    const req = {
      body: { itemId: "inexistente", targetSpaceId: "space-2" },
      inventoryId: "inv-1",
      user: { sub: "tester" },
    };
    const res = createMockResponse();

    await handler(req, res);

    assert.equal(res.statusCode, 404);
    assert.deepEqual(res.body, { error: "Item não encontrado" });
  } finally {
    prisma.item.findUnique = origFindUnique;
  }
});

test("POST /relocate retorna 400 quando destino e igual a origem", async () => {
  const handler = getRouteHandler("/relocate");

  const origFindUnique = prisma.item.findUnique;
  const origFindFirst = prisma.space.findFirst;

  prisma.item.findUnique = async () => ({
    id: "item-1",
    spaceId: "space-1",
    lastKnownSpaceId: null,
    inventoryId: "inv-1",
    statusEncontrado: "PENDENTE",
  });
  prisma.space.findFirst = async () => ({ id: "space-1" });

  try {
    const req = {
      body: { itemId: "item-1", targetSpaceId: "space-1" },
      inventoryId: "inv-1",
      user: { sub: "tester" },
    };
    const res = createMockResponse();

    await handler(req, res);

    assert.equal(res.statusCode, 400);
    assert.ok(res.body.error.includes("já está no espaço de destino"));
  } finally {
    prisma.item.findUnique = origFindUnique;
    prisma.space.findFirst = origFindFirst;
  }
});
