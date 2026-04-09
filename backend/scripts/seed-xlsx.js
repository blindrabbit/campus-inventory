// backend/scripts/seed-xlsx.js
import pkg from "@prisma/client";
const { PrismaClient } = pkg;
import ExcelJS from "exceljs";
import { existsSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const prisma = new PrismaClient();
const INVENTORY_SHEET = "BD_PATRIMONIO";

const NEW_TEMPLATE_PATH = join(
  __dirname,
  "../../planilha_campus_aracruz_05032025.xlsx",
);
const LEGACY_TEMPLATE_PATH = join(__dirname, "../inventario.xlsx");

// Permite sobrescrever por variável de ambiente (XLSX_PATH)
const XLSX_PATH =
  process.env.XLSX_PATH ||
  (existsSync(NEW_TEMPLATE_PATH) ? NEW_TEMPLATE_PATH : LEGACY_TEMPLATE_PATH);

// Mapeamento de colunas do Excel → Campos do Prisma
const COLUMN_MAP = {
  patrimonio: "patrimonio",
  descricao: "descricao",
  valor: "valor",
  condicao: "condicaoOriginal",
  fornecedor: "fornecedor",
  cnpj_fornecedor: "cnpjFornecedor",
  catalogo: "catalogo",
  codigo_sia: "codigoSIA",
  descricao_sia: "descricaoSIA",
  numero_entrada: "numeroEntrada",
  data_entrada: "dataEntrada",
  data_aquisicao: "dataAquisicao",
  documento: "documento",
  data_documento: "dataDocumento",
  tipo_aquisicao: "tipoAquisicao",
  "você digita a sala": "spaceName",
  responsavel: "spaceResponsible",
  setor: "sector",
  unidade: "unit",
  Encontrado: "statusEncontrado",
  "(estado)": "estadoOriginal",
};

// Converter valor monetário "R$ 1.234,56" → Decimal
function parseCurrency(value) {
  if (!value) return null;
  const cleaned = value
    .toString()
    .replace("R$", "")
    .replace(/\./g, "")
    .replace(",", ".")
    .trim();
  const num = parseFloat(cleaned);
  return isNaN(num) ? null : num;
}

// Converter data do Excel (pode vir como número serial ou string)
function parseDate(value) {
  if (!value) return null;
  if (value instanceof Date) return value;
  if (typeof value === "number") {
    // Excel serial date
    return new Date(Math.round((value - 25569) * 86400 * 1000));
  }
  const date = new Date(value);
  return isNaN(date.getTime()) ? null : date;
}

function worksheetToObjects(worksheet) {
  const rows = [];
  const headerRow = worksheet.getRow(1);
  const headers = [];

  headerRow.eachCell({ includeEmpty: true }, (cell, colNumber) => {
    headers[colNumber - 1] = cell.value?.toString().trim() || "";
  });

  for (let rowIndex = 2; rowIndex <= worksheet.rowCount; rowIndex += 1) {
    const row = worksheet.getRow(rowIndex);
    const rowData = {};
    let hasAnyValue = false;

    headers.forEach((header, index) => {
      if (!header) return;
      const cellValue = row.getCell(index + 1).value;
      const value =
        typeof cellValue === "object" && cellValue !== null
          ? cellValue.text || cellValue.result || null
          : cellValue;
      if (value !== null && value !== undefined && value !== "") {
        hasAnyValue = true;
      }
      rowData[header] = value ?? null;
    });

    if (hasAnyValue) {
      rows.push(rowData);
    }
  }

  return rows;
}

async function ensureDefaultInventory() {
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
    },
  });
}

async function seed() {
  console.log("🚀 Iniciando seed da planilha de inventário...");

  const defaultInventory = await ensureDefaultInventory();

  if (!existsSync(XLSX_PATH)) {
    throw new Error(`Arquivo de inventário não encontrado em: ${XLSX_PATH}`);
  }

  // Ler arquivo Excel
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.readFile(XLSX_PATH);
  const worksheet =
    workbook.getWorksheet(INVENTORY_SHEET) || workbook.worksheets[0];
  const sheetName = worksheet?.name;

  if (!worksheet || !sheetName) {
    throw new Error("Nenhuma aba válida encontrada no arquivo XLSX");
  }

  const rawData = worksheetToObjects(worksheet);

  console.log(`📄 Lidas ${rawData.length} linhas da aba ${sheetName}`);

  // 1. Extrair espaços únicos da coluna "você digita a sala"
  const spacesMap = new Map();
  for (const row of rawData) {
    const sala = row["você digita a sala"]?.toString().trim();
    const setor = row["setor"]?.toString().trim();
    const spaceName = sala || setor || "SEM_LOCAL";
    const responsible =
      row["responsavel"]?.toString().trim() || "Não informado";

    if (!spacesMap.has(spaceName)) {
      spacesMap.set(spaceName, { name: spaceName, responsible });
    }
  }

  console.log(`🏢 Encontrados ${spacesMap.size} espaços únicos`);

  // 2. Criar espaços no banco
  for (const [name, spaceData] of spacesMap) {
    const existingSpace = await prisma.space.findFirst({
      where: { name, inventoryId: defaultInventory.id },
    });

    if (!existingSpace) {
      await prisma.space.create({
        data: {
          name,
          responsible: spaceData.responsible,
          inventoryId: defaultInventory.id,
          isActive: true,
          isFinalized: false,
        },
      });
      continue;
    }

    await prisma.space.update({
      where: { id: existingSpace.id },
      data: { responsible: spaceData.responsible },
    });
  }

  // 3. Criar/atualizar itens
  let created = 0,
    updated = 0,
    skipped = 0;

  for (const row of rawData) {
    const patrimonio = row["patrimonio"]?.toString().trim();
    const sala = row["você digita a sala"]?.toString().trim();
    const setor = row["setor"]?.toString().trim();
    const spaceName = sala || setor || "SEM_LOCAL";

    if (!patrimonio) {
      skipped++;
      continue;
    }

    // Buscar espaço
    const space = await prisma.space.findFirst({
      where: { name: spaceName, inventoryId: defaultInventory.id },
    });
    if (!space) {
      console.warn(
        `⚠️ Espaço não encontrado: "${spaceName}" - pulando item ${patrimonio}`,
      );
      skipped++;
      continue;
    }

    // Mapear dados
    const itemData = {
      patrimonio,
      descricao: row["descricao"]?.toString() || "",
      valor: parseCurrency(row["valor"]),
      condicaoOriginal: row["condicao"]?.toString() || "",
      fornecedor: row["fornecedor"]?.toString(),
      cnpjFornecedor: row["cnpj_fornecedor"]?.toString(),
      catalogo: row["catalogo"]?.toString(),
      codigoSIA: row["codigo_sia"]?.toString(),
      descricaoSIA: row["descricao_sia"]?.toString(),
      numeroEntrada: row["numero_entrada"]?.toString(),
      dataEntrada: parseDate(row["data_entrada"]),
      dataAquisicao: parseDate(row["data_aquisicao"]),
      documento: row["documento"]?.toString(),
      dataDocumento: parseDate(row["data_documento"]),
      tipoAquisicao: row["tipo_aquisicao"]?.toString(),
      inventoryId: defaultInventory.id,
      spaceId: space.id,
      // Status inicial: se não vier marcado como encontrado na planilha,
      // entra como PENDENTE para aparecer no fluxo de conferência.
      statusEncontrado:
        row["Encontrado"]?.toString().toLowerCase() === "sim"
          ? "SIM"
          : "PENDENTE",
      condicaoVisual: null, // Será preenchido durante a conferência
      dataConferencia: null,
      ultimoConferente: null,
    };

    // Upsert: cria ou atualiza sem duplicar patrimônio
    const result = await prisma.item.upsert({
      where: {
        inventoryId_patrimonio: {
          inventoryId: defaultInventory.id,
          patrimonio,
        },
      },
      update: { ...itemData, updatedAt: new Date() },
      create: itemData,
    });

    if (result.createdAt.getTime() === result.updatedAt.getTime()) {
      created++;
    } else {
      updated++;
    }
  }

  // Resumo
  console.log("\n✅ Seed concluído!");
  console.log(`   🆕 Itens criados: ${created}`);
  console.log(`   🔄 Itens atualizados: ${updated}`);
  console.log(`   ⏭️  Itens pulados: ${skipped}`);
  console.log(`   🏢 Espaços registrados: ${spacesMap.size}`);
}

// Executar
seed()
  .catch((err) => {
    console.error("❌ Erro no seed:", err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
