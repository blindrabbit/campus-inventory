import jwt from "jsonwebtoken";
import { prisma } from "../src/prisma/client.js";

const BASE_URL = process.env.TEST_API_BASE_URL || "http://localhost:8088";
const JWT_SECRET =
  process.env.JWT_SECRET || "dev-secret-123-mude-em-producao-urgente";

const report = [];

function addResult(name, ok, details = "") {
  report.push({ name, ok, details });
}

function tokenFor(sam, role = "CONFERENTE", fullName = sam) {
  return jwt.sign({ sub: sam, role, fullName }, JWT_SECRET, {
    expiresIn: "1h",
  });
}

async function request(name, config, expectedStatus) {
  try {
    const method = (config.method || "GET").toUpperCase();
    const headers = config.headers || {};

    const finalUrl = (() => {
      if (!config.params) return config.url;
      const url = new URL(config.url);
      for (const [key, value] of Object.entries(config.params)) {
        if (value !== undefined && value !== null) {
          url.searchParams.set(key, value.toString());
        }
      }
      return url.toString();
    })();

    const body =
      config.data !== undefined && config.data !== null
        ? JSON.stringify(config.data)
        : undefined;

    if (body && !headers["Content-Type"]) {
      headers["Content-Type"] = "application/json";
    }

    const response = await fetch(finalUrl, {
      method,
      headers,
      body,
    });

    const ok = Array.isArray(expectedStatus)
      ? expectedStatus.includes(response.status)
      : response.status === expectedStatus;

    addResult(
      name,
      ok,
      `status=${response.status} expected=${Array.isArray(expectedStatus) ? expectedStatus.join("|") : expectedStatus}`,
    );

    return response;
  } catch (error) {
    addResult(name, false, `request error: ${error.message}`);
    return null;
  }
}

async function main() {
  const fixtureTag = `rls_${Date.now()}`;
  const adminSam = `${fixtureTag}_admin`;
  const confSam = `${fixtureTag}_conf`;
  const viewSam = `${fixtureTag}_view`;

  try {
    await prisma.inventoryUser.deleteMany({
      where: { user: { samAccountName: { startsWith: fixtureTag } } },
    });
    await prisma.item.deleteMany({
      where: { inventory: { name: { startsWith: fixtureTag } } },
    });
    await prisma.space.deleteMany({
      where: { inventory: { name: { startsWith: fixtureTag } } },
    });
    await prisma.inventory.deleteMany({
      where: { name: { startsWith: fixtureTag } },
    });
    await prisma.user.deleteMany({
      where: { samAccountName: { startsWith: fixtureTag } },
    });

    const [admin, conf, view] = await Promise.all([
      prisma.user.create({
        data: {
          samAccountName: adminSam,
          fullName: "Admin Release",
          role: "ADMIN",
        },
      }),
      prisma.user.create({
        data: {
          samAccountName: confSam,
          fullName: "Conf Release",
          role: "CONFERENTE",
        },
      }),
      prisma.user.create({
        data: {
          samAccountName: viewSam,
          fullName: "View Release",
          role: "VISUALIZADOR",
        },
      }),
    ]);

    const inventory = await prisma.inventory.create({
      data: {
        name: `${fixtureTag}_inventory`,
        campus: "Campus Aracruz",
        sourceType: "UPLOAD_XLSX",
        statusOperacao: "EM_EXECUCAO",
        createdById: admin.id,
        users: {
          create: [
            { userId: admin.id, role: "ADMIN_CICLO" },
            { userId: conf.id, role: "CONFERENTE" },
            { userId: view.id, role: "VISUALIZADOR" },
          ],
        },
      },
    });

    const space = await prisma.space.create({
      data: {
        name: `${fixtureTag}_space`,
        responsible: "Resp Test",
        sector: "Setor Test",
        unit: "Unidade Test",
        inventoryId: inventory.id,
      },
    });

    const item = await prisma.item.create({
      data: {
        patrimonio: `${Date.now()}`,
        descricao: "Item Teste",
        condicaoOriginal: "BOM",
        statusEncontrado: "PENDENTE",
        inventoryId: inventory.id,
        spaceId: space.id,
      },
    });

    const adminToken = tokenFor(adminSam, "ADMIN", admin.fullName);
    const confToken = tokenFor(confSam, "CONFERENTE", conf.fullName);
    const viewToken = tokenFor(viewSam, "VISUALIZADOR", view.fullName);

    await request(
      "Health endpoint",
      { method: "get", url: `${BASE_URL}/api/health` },
      200,
    );

    await request(
      "Unauthorized inventories/my",
      { method: "get", url: `${BASE_URL}/api/inventories/my` },
      401,
    );

    await request(
      "Admin inventories/my",
      {
        method: "get",
        url: `${BASE_URL}/api/inventories/my`,
        headers: { Authorization: `Bearer ${adminToken}` },
      },
      200,
    );

    await request(
      "Conferente can read spaces",
      {
        method: "get",
        url: `${BASE_URL}/api/spaces/active`,
        params: { inventoryId: inventory.id },
        headers: { Authorization: `Bearer ${confToken}` },
      },
      200,
    );

    await request(
      "Visualizador blocked from check",
      {
        method: "post",
        url: `${BASE_URL}/api/items/check`,
        headers: { Authorization: `Bearer ${viewToken}` },
        data: {
          inventoryId: inventory.id,
          itemId: item.id,
          condicaoVisual: "BOM",
          statusEncontrado: "SIM",
        },
      },
      403,
    );

    await request(
      "Conferente can check item",
      {
        method: "post",
        url: `${BASE_URL}/api/items/check`,
        headers: { Authorization: `Bearer ${confToken}` },
        data: {
          inventoryId: inventory.id,
          itemId: item.id,
          condicaoVisual: "BOM",
          statusEncontrado: "SIM",
        },
      },
      [200, 201],
    );

    await request(
      "Visualizador blocked from inventory patch",
      {
        method: "patch",
        url: `${BASE_URL}/api/inventories/${inventory.id}`,
        headers: { Authorization: `Bearer ${viewToken}` },
        params: { inventoryId: inventory.id },
        data: { name: `${fixtureTag}_renamed` },
      },
      403,
    );

    await request(
      "Admin ciclo can patch inventory",
      {
        method: "patch",
        url: `${BASE_URL}/api/inventories/${inventory.id}`,
        headers: { Authorization: `Bearer ${adminToken}` },
        params: { inventoryId: inventory.id },
        data: { name: `${fixtureTag}_renamed` },
      },
      200,
    );

    await request(
      "Admin can access global users",
      {
        method: "get",
        url: `${BASE_URL}/api/admin/users`,
        headers: { Authorization: `Bearer ${adminToken}` },
      },
      200,
    );

    await request(
      "Conferente blocked on global users",
      {
        method: "get",
        url: `${BASE_URL}/api/admin/users`,
        headers: { Authorization: `Bearer ${confToken}` },
      },
      403,
    );

    await request(
      "Inventory export xlsx",
      {
        method: "get",
        url: `${BASE_URL}/api/export/xlsx`,
        params: { inventoryId: inventory.id },
        responseType: "arraybuffer",
        headers: { Authorization: `Bearer ${adminToken}` },
      },
      200,
    );

    await request(
      "Portaria parse unauth blocked",
      {
        method: "post",
        url: `${BASE_URL}/api/inventories/commission/parse`,
      },
      401,
    );

    await request(
      "Login brute-force rate headers",
      {
        method: "post",
        url: `${BASE_URL}/api/auth/login`,
        data: { sAMAccountName: "invalid", password: "invalid" },
      },
      [400, 401, 429],
    );
  } finally {
    await prisma.$disconnect();
  }

  const failed = report.filter((r) => !r.ok);
  console.log("\n=== Release Regression Report ===");
  for (const row of report) {
    console.log(`${row.ok ? "PASS" : "FAIL"} - ${row.name} (${row.details})`);
  }

  if (failed.length > 0) {
    console.log(`\nFAILED: ${failed.length}`);
    process.exit(1);
  }

  console.log("\nALL CHECKS PASSED");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
