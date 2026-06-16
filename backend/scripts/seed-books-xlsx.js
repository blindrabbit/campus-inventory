// Importa livros de acervo bibliográfico a partir de exportação do sistema de biblioteca.
// Uso:
//   INVENTORY_ID=<id>   SPACE_NAME="Biblioteca"  node scripts/seed-books-xlsx.js
//   INVENTORY_NAME=<nm> SPACE_NAME="Biblioteca"  node scripts/seed-books-xlsx.js
//   XLSX_PATH=/caminho/para/arquivo.xlsx          node scripts/seed-books-xlsx.js
//
// Colunas esperadas (por posição, baseadas no export da biblioteca):
//   B  (2)  → Código de barras      [identificador principal]
//   C  (3)  → Código do exemplar
//   P  (16) → Número do exemplar
//   AF (32) → Número do patrimônio  [opcional]
//   AH (34) → Título
//   BA (53) → Autores
//   BG (59) → Ano de publicação
//   Última  → Código RFID           [coluna adicionada manualmente ao XLSX]

import pkg from "@prisma/client";
const { PrismaClient } = pkg;
import ExcelJS from "exceljs";
import { existsSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const prisma = new PrismaClient();

// Índices de coluna (1-based, conforme referência de letras do Excel)
const COL = {
  CODIGO_BARRAS:   2,   // B
  CODIGO_EXEMPLAR: 3,   // C
  NUMERO_EXEMPLAR: 16,  // P
  PATRIMONIO:      32,  // AF
  TITULO:          34,  // AH
  AUTORES:         53,  // BA
  ANO_PUBLICACAO:  59,  // BG
  // RFID: última coluna do worksheet (detectada dinamicamente)
};

const XLSX_PATH =
  process.env.XLSX_PATH ||
  join(__dirname, "../../livros.xlsx");

const SPACE_NAME =
  (process.env.SPACE_NAME || "Biblioteca").trim();

function cellText(row, colIndex) {
  const cell = row.getCell(colIndex);
  const v = cell.value;
  if (v === null || v === undefined) return null;
  if (typeof v === "object" && v !== null) {
    const text = v.text ?? v.result ?? null;
    return text !== null ? String(text).trim() || null : null;
  }
  return String(v).trim() || null;
}

async function resolveInventory() {
  if (process.env.INVENTORY_ID) {
    const inv = await prisma.inventory.findUnique({
      where: { id: process.env.INVENTORY_ID },
    });
    if (!inv) throw new Error(`Inventário não encontrado: ${process.env.INVENTORY_ID}`);
    return inv;
  }

  if (process.env.INVENTORY_NAME) {
    const inv = await prisma.inventory.findFirst({
      where: { name: { contains: process.env.INVENTORY_NAME } },
      orderBy: { createdAt: "desc" },
    });
    if (!inv) throw new Error(`Inventário não encontrado: ${process.env.INVENTORY_NAME}`);
    return inv;
  }

  // Fallback: inventário mais recente
  const inv = await prisma.inventory.findFirst({ orderBy: { createdAt: "desc" } });
  if (!inv) throw new Error("Nenhum inventário encontrado. Crie um inventário antes de importar.");
  console.warn(`⚠️  Nenhum INVENTORY_ID/INVENTORY_NAME definido. Usando inventário mais recente: "${inv.name}" (${inv.id})`);
  return inv;
}

async function resolveSpace(inventoryId) {
  let space = await prisma.space.findFirst({
    where: {
      name: SPACE_NAME,
      inventoryId,
    },
  });

  if (!space) {
    console.log(`🏢 Sala "${SPACE_NAME}" não encontrada — criando...`);
    space = await prisma.space.create({
      data: {
        name: SPACE_NAME,
        responsible: "Biblioteca",
        inventoryId,
        isActive: true,
        isFinalized: false,
      },
    });
  }

  return space;
}

async function seed() {
  console.log("📚 Iniciando importação de livros do acervo bibliográfico...\n");

  if (!existsSync(XLSX_PATH)) {
    throw new Error(`Arquivo não encontrado: ${XLSX_PATH}\nDefina XLSX_PATH=<caminho> ou coloque o arquivo em ${XLSX_PATH}`);
  }

  const inventory = await resolveInventory();
  console.log(`📦 Inventário: "${inventory.name}" (${inventory.id})`);

  const space = await resolveSpace(inventory.id);
  console.log(`🏢 Sala de destino: "${space.name}" (${space.id})`);

  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.readFile(XLSX_PATH);

  const worksheet = workbook.worksheets[0];
  if (!worksheet) throw new Error("Nenhuma aba encontrada no arquivo XLSX.");

  // Detectar última coluna (para RFID)
  let maxCol = 0;
  worksheet.getRow(1).eachCell({ includeEmpty: false }, (_, colNum) => {
    if (colNum > maxCol) maxCol = colNum;
  });
  const COL_RFID = maxCol;

  // Mostrar cabeçalhos das colunas mapeadas para conferência
  const headerRow = worksheet.getRow(1);
  console.log("\n📋 Mapeamento de colunas detectado:");
  const colMap = {
    "Código de barras":   COL.CODIGO_BARRAS,
    "Código do exemplar": COL.CODIGO_EXEMPLAR,
    "Nº do exemplar":     COL.NUMERO_EXEMPLAR,
    "Patrimônio":         COL.PATRIMONIO,
    "Título":             COL.TITULO,
    "Autores":            COL.AUTORES,
    "Ano publicação":     COL.ANO_PUBLICACAO,
    "RFID":               COL_RFID,
  };
  for (const [label, col] of Object.entries(colMap)) {
    const header = cellText(headerRow, col) || "(vazio)";
    console.log(`  Col ${String(col).padStart(2)}: ${label.padEnd(20)} → "${header}"`);
  }
  console.log();

  let created = 0, updated = 0, skipped = 0, errors = 0;
  const totalRows = worksheet.rowCount - 1; // descontar cabeçalho

  for (let rowIndex = 2; rowIndex <= worksheet.rowCount; rowIndex++) {
    const row = worksheet.getRow(rowIndex);

    const codigoBarras    = cellText(row, COL.CODIGO_BARRAS);
    const codigoExemplar  = cellText(row, COL.CODIGO_EXEMPLAR);
    const numeroExemplar  = cellText(row, COL.NUMERO_EXEMPLAR);
    const patrimonio      = cellText(row, COL.PATRIMONIO);
    const titulo          = cellText(row, COL.TITULO);
    const autores         = cellText(row, COL.AUTORES);
    const anoPublicacao   = cellText(row, COL.ANO_PUBLICACAO);
    const codigoRFID      = cellText(row, COL_RFID);

    // Linha completamente vazia
    if (!codigoBarras && !patrimonio && !titulo) {
      skipped++;
      continue;
    }

    // Sem identificador único → não é possível fazer upsert
    if (!codigoBarras && !patrimonio) {
      console.warn(`  ⚠️  Linha ${rowIndex}: sem código de barras nem patrimônio — pulando`);
      skipped++;
      continue;
    }

    const itemData = {
      descricao:       titulo || "Sem título",
      condicaoOriginal: "BOM",
      autores:         autores   || null,
      anoPublicacao:   anoPublicacao || null,
      codigoBarras:    codigoBarras  || null,
      codigoRFID:      codigoRFID    || null,
      numeroExemplar:  numeroExemplar || null,
      codigoExemplar:  codigoExemplar || null,
      patrimonio:      patrimonio    || null,
      inventoryId:     inventory.id,
      spaceId:         space.id,
      statusEncontrado: "PENDENTE",
    };

    try {
      if (codigoBarras) {
        // Upsert pelo código de barras (identificador primário do acervo)
        const existing = await prisma.item.findUnique({
          where: {
            inventoryId_codigoBarras: {
              inventoryId: inventory.id,
              codigoBarras,
            },
          },
        });

        if (existing) {
          await prisma.item.update({
            where: { id: existing.id },
            data: { ...itemData, updatedAt: new Date() },
          });
          updated++;
        } else {
          await prisma.item.create({ data: itemData });
          created++;
        }
      } else {
        // Fallback: atualiza por patrimônio apenas para item sem código de barras.
        const existing = await prisma.item.findFirst({
          where: {
            inventoryId: inventory.id,
            patrimonio,
            codigoBarras: null,
          },
          select: { id: true },
        });

        if (existing) {
          await prisma.item.update({
            where: { id: existing.id },
            data: { ...itemData, updatedAt: new Date() },
          });
          updated++;
        } else {
          await prisma.item.create({ data: itemData });
          created++;
        }
      }
    } catch (err) {
      console.error(`  ❌ Linha ${rowIndex} (barras="${codigoBarras}", patrimônio="${patrimonio}"): ${err.message}`);
      errors++;
    }
  }

  console.log("✅ Importação concluída!");
  console.log(`   🆕 Itens criados:     ${created}`);
  console.log(`   🔄 Itens atualizados: ${updated}`);
  console.log(`   ⏭️  Linhas puladas:   ${skipped}`);
  console.log(`   ❌ Erros:             ${errors}`);
  console.log(`   📄 Total de linhas:   ${totalRows}`);
}

seed()
  .catch((err) => {
    console.error("\n💥 Erro fatal:", err.message);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
