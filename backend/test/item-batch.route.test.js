import test from "node:test";
import assert from "node:assert/strict";
import router from "../src/routes/item.routes.js";
import { prisma } from "../src/prisma/client.js";

function getPostRouteHandler(path) {
  const layer = router.stack.find(
    (entry) => entry.route?.path === path && entry.route?.methods?.post,
  );
  assert.ok(layer, `Route POST ${path} não encontrada`);
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

// Mock $transaction para suportar forma de callback (async tx) e forma de array
function mockTransaction(prismaClient) {
  return async (opsOrCallback) => {
    if (typeof opsOrCallback === "function") {
      return opsOrCallback(prismaClient);
    }
    return Promise.all(opsOrCallback);
  };
}

// ────────────────────────────────────────────────────────────────────────────
// POST /unfound-batch
// ────────────────────────────────────────────────────────────────────────────

test("POST /unfound-batch com dryRun retorna contagem de itens no intervalo", async () => {
  const handler = getPostRouteHandler("/unfound-batch");

  const origFindFirst = prisma.space.findFirst;
  const origFindMany = prisma.item.findMany;

  prisma.space.findFirst = async () => ({ id: "space-1" });
  prisma.item.findMany = async () => [
    { id: "a", patrimonio: "100" },
    { id: "b", patrimonio: "150" },
    { id: "c", patrimonio: "200" },
    { id: "d", patrimonio: "999" }, // fora do intervalo 100-200
  ];

  try {
    const req = {
      body: {
        spaceId: "space-1",
        patrimonioInicial: "100",
        patrimonioFinal: "200",
        dryRun: true,
      },
      inventoryId: "inv-1",
      user: { sub: "tester", fullName: "Tester" },
    };
    const res = createMockResponse();

    await handler(req, res);

    assert.equal(res.statusCode, 200);
    assert.equal(res.body.dryRun, true);
    assert.equal(res.body.matchedCount, 3);
    assert.equal(res.body.skippedCount, 1);
  } finally {
    prisma.space.findFirst = origFindFirst;
    prisma.item.findMany = origFindMany;
  }
});

test("POST /unfound-batch marca itens como NAO e chama markSpaceStarted", async () => {
  const handler = getPostRouteHandler("/unfound-batch");

  const origFindFirst = prisma.space.findFirst;
  const origFindMany = prisma.item.findMany;
  const origTransaction = prisma.$transaction;
  const origItemUpdate = prisma.item.updateMany;
  const origHistoricoCreate = prisma.itemHistorico.createMany;
  const origSpaceUpdate = prisma.space.updateMany;

  let itemUpdatePayload = null;
  let historyPayload = null;
  let spaceUpdateCalled = false;

  prisma.space.findFirst = async () => ({ id: "space-1" });
  prisma.item.findMany = async () => [
    { id: "a", patrimonio: "100" },
    { id: "b", patrimonio: "150" },
  ];
  prisma.$transaction = mockTransaction(prisma);
  prisma.item.updateMany = async (payload) => {
    itemUpdatePayload = payload;
    return { count: 2 };
  };
  prisma.itemHistorico.createMany = async (payload) => {
    historyPayload = payload;
    return { count: 2 };
  };
  prisma.space.updateMany = async () => {
    spaceUpdateCalled = true;
    return { count: 1 };
  };

  try {
    const req = {
      body: {
        spaceId: "space-1",
        patrimonioInicial: "100",
        patrimonioFinal: "200",
      },
      inventoryId: "inv-1",
      user: { sub: "tester", fullName: "Tester" },
    };
    const res = createMockResponse();

    await handler(req, res);

    assert.equal(res.statusCode, 200);
    assert.equal(res.body.success, true);
    assert.equal(res.body.updatedCount, 2);

    // Itens devem ser marcados como NAO
    assert.equal(itemUpdatePayload.data.statusEncontrado, "NAO");
    assert.equal(itemUpdatePayload.data.lastKnownSpaceId, "space-1");
    assert.ok(itemUpdatePayload.data.dataConferencia instanceof Date);

    // Histórico deve registrar NAO_LOCALIZADO
    assert.ok(historyPayload.data.every((h) => h.action === "NAO_LOCALIZADO"));
    assert.ok(historyPayload.data.every((h) => h.fromSpaceId === "space-1"));

    // markSpaceStarted deve ser chamado para unfound (é ação de conferência)
    assert.equal(
      spaceUpdateCalled,
      true,
      "markSpaceStarted deve ser chamado ao marcar como não localizado",
    );
  } finally {
    prisma.space.findFirst = origFindFirst;
    prisma.item.findMany = origFindMany;
    prisma.$transaction = origTransaction;
    prisma.item.updateMany = origItemUpdate;
    prisma.itemHistorico.createMany = origHistoricoCreate;
    prisma.space.updateMany = origSpaceUpdate;
  }
});

test("POST /unfound-batch retorna 400 sem spaceId", async () => {
  const handler = getPostRouteHandler("/unfound-batch");

  const req = {
    body: { patrimonioInicial: "100", patrimonioFinal: "200" },
    inventoryId: "inv-1",
    user: { sub: "tester" },
  };
  const res = createMockResponse();

  await handler(req, res);

  assert.equal(res.statusCode, 400);
  assert.ok(res.body.error.includes("obrigatórios"));
});

// ────────────────────────────────────────────────────────────────────────────
// POST /relocate-batch
// ────────────────────────────────────────────────────────────────────────────

test("POST /relocate-batch com dryRun retorna contagem de itens no intervalo", async () => {
  const handler = getPostRouteHandler("/relocate-batch");

  const origFindFirst = prisma.space.findFirst;
  const origFindMany = prisma.item.findMany;

  // findFirst é chamado duas vezes: space de origem e de destino
  let findFirstCount = 0;
  prisma.space.findFirst = async () => {
    findFirstCount++;
    return { id: findFirstCount === 1 ? "space-1" : "space-2", name: "Sala Destino" };
  };
  prisma.item.findMany = async () => [
    { id: "a", patrimonio: "500", statusEncontrado: "PENDENTE" },
    { id: "b", patrimonio: "600", statusEncontrado: "NAO" },
    { id: "c", patrimonio: "700", statusEncontrado: "PENDENTE" },
    { id: "d", patrimonio: "9999", statusEncontrado: "PENDENTE" }, // fora
  ];

  try {
    const req = {
      body: {
        spaceId: "space-1",
        targetSpaceId: "space-2",
        patrimonioInicial: "500",
        patrimonioFinal: "700",
        dryRun: true,
      },
      inventoryId: "inv-1",
      user: { sub: "tester", fullName: "Tester" },
    };
    const res = createMockResponse();

    await handler(req, res);

    assert.equal(res.statusCode, 200);
    assert.equal(res.body.dryRun, true);
    assert.equal(res.body.matchedCount, 3);
    assert.equal(res.body.skippedCount, 1);
  } finally {
    prisma.space.findFirst = origFindFirst;
    prisma.item.findMany = origFindMany;
  }
});

test("POST /relocate-batch define wasUnfound=true para itens que eram NAO", async () => {
  const handler = getPostRouteHandler("/relocate-batch");

  const origFindFirst = prisma.space.findFirst;
  const origFindMany = prisma.item.findMany;
  const origTransaction = prisma.$transaction;
  const origItemUpdate = prisma.item.updateMany;
  const origRelocDelete = prisma.relocation.deleteMany;
  const origRelocCreate = prisma.relocation.createMany;
  const origHistorico = prisma.itemHistorico.createMany;
  const origSpaceUpdate = prisma.space.updateMany;

  let relocationCreatePayload = null;
  let spaceUpdateCalled = false;

  let findFirstCount = 0;
  prisma.space.findFirst = async () => {
    findFirstCount++;
    return { id: findFirstCount === 1 ? "space-1" : "space-2", name: "Sala Destino" };
  };
  prisma.item.findMany = async () => [
    { id: "item-nao", patrimonio: "100", statusEncontrado: "NAO" },
    { id: "item-pendente", patrimonio: "150", statusEncontrado: "PENDENTE" },
    { id: "item-sim", patrimonio: "200", statusEncontrado: "SIM" },
  ];
  prisma.$transaction = mockTransaction(prisma);
  prisma.item.updateMany = async () => ({ count: 3 });
  prisma.relocation.deleteMany = async () => ({ count: 0 });
  prisma.relocation.createMany = async (payload) => {
    relocationCreatePayload = payload;
    return { count: 3 };
  };
  prisma.itemHistorico.createMany = async () => ({ count: 3 });
  prisma.space.updateMany = async () => {
    spaceUpdateCalled = true;
    return { count: 1 };
  };

  try {
    const req = {
      body: {
        spaceId: "space-1",
        targetSpaceId: "space-2",
        patrimonioInicial: "100",
        patrimonioFinal: "200",
      },
      inventoryId: "inv-1",
      user: { sub: "tester", fullName: "Tester" },
    };
    const res = createMockResponse();

    await handler(req, res);

    assert.equal(res.statusCode, 200);
    assert.equal(res.body.updatedCount, 3);

    assert.ok(relocationCreatePayload, "relocation.createMany deve ser chamado");
    const records = relocationCreatePayload.data;

    const naoRecord = records.find((r) => r.itemId === "item-nao");
    const pendenteRecord = records.find((r) => r.itemId === "item-pendente");
    const simRecord = records.find((r) => r.itemId === "item-sim");

    assert.equal(naoRecord.wasUnfound, true, "item NAO deve ter wasUnfound=true");
    assert.equal(pendenteRecord.wasUnfound, false, "item PENDENTE deve ter wasUnfound=false");
    assert.equal(simRecord.wasUnfound, false, "item SIM deve ter wasUnfound=false");

    // relocate-batch NÃO deve chamar markSpaceStarted
    assert.equal(
      spaceUpdateCalled,
      false,
      "markSpaceStarted NÃO deve ser chamado ao mover itens em lote",
    );
  } finally {
    prisma.space.findFirst = origFindFirst;
    prisma.item.findMany = origFindMany;
    prisma.$transaction = origTransaction;
    prisma.item.updateMany = origItemUpdate;
    prisma.relocation.deleteMany = origRelocDelete;
    prisma.relocation.createMany = origRelocCreate;
    prisma.itemHistorico.createMany = origHistorico;
    prisma.space.updateMany = origSpaceUpdate;
  }
});

test("POST /relocate-batch retorna 400 quando origem e destino sao iguais", async () => {
  const handler = getPostRouteHandler("/relocate-batch");

  const req = {
    body: {
      spaceId: "space-1",
      targetSpaceId: "space-1",
      patrimonioInicial: "100",
      patrimonioFinal: "200",
    },
    inventoryId: "inv-1",
    user: { sub: "tester" },
  };
  const res = createMockResponse();

  await handler(req, res);

  assert.equal(res.statusCode, 400);
  assert.ok(res.body.error.includes("diferente"));
});

// ────────────────────────────────────────────────────────────────────────────
// POST /check-batch — controle positivo: markSpaceStarted deve ser chamado
// ────────────────────────────────────────────────────────────────────────────

test("POST /check-batch ainda chama markSpaceStarted (ação de conferência)", async () => {
  const handler = getPostRouteHandler("/check-batch");

  const origFindFirst = prisma.space.findFirst;
  const origFindMany = prisma.item.findMany;
  const origTransaction = prisma.$transaction;
  const origItemUpdate = prisma.item.updateMany;
  const origRelocUpdate = prisma.relocation.updateMany;
  const origHistorico = prisma.itemHistorico.createMany;
  const origSpaceUpdate = prisma.space.updateMany;

  let spaceUpdateCalled = false;

  prisma.space.findFirst = async () => ({ id: "space-1" });
  prisma.item.findMany = async () => [
    { id: "a", patrimonio: "300" },
    { id: "b", patrimonio: "400" },
  ];
  prisma.$transaction = mockTransaction(prisma);
  prisma.item.updateMany = async () => ({ count: 2 });
  prisma.relocation.updateMany = async () => ({ count: 0 });
  prisma.itemHistorico.createMany = async () => ({ count: 2 });
  prisma.space.updateMany = async () => {
    spaceUpdateCalled = true;
    return { count: 1 };
  };

  try {
    const req = {
      body: {
        spaceId: "space-1",
        patrimonioInicial: "300",
        patrimonioFinal: "400",
        condicaoVisual: "EXCELENTE",
      },
      inventoryId: "inv-1",
      user: { sub: "tester", fullName: "Tester" },
    };
    const res = createMockResponse();

    await handler(req, res);

    assert.equal(res.statusCode, 200);
    assert.equal(res.body.updatedCount, 2);
    assert.equal(
      spaceUpdateCalled,
      true,
      "markSpaceStarted DEVE ser chamado ao confirmar itens em lote",
    );
  } finally {
    prisma.space.findFirst = origFindFirst;
    prisma.item.findMany = origFindMany;
    prisma.$transaction = origTransaction;
    prisma.item.updateMany = origItemUpdate;
    prisma.relocation.updateMany = origRelocUpdate;
    prisma.itemHistorico.createMany = origHistorico;
    prisma.space.updateMany = origSpaceUpdate;
  }
});
