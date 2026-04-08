// backend/scripts/seed-xlsx.js
import pkg from '@prisma/client';
const { PrismaClient } = pkg;
import * as XLSX from 'xlsx';
import { existsSync, readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const prisma = new PrismaClient();
const INVENTORY_SHEET = 'BD_PATRIMONIO';

// Permite sobrescrever por variável de ambiente (XLSX_PATH)
const XLSX_PATH = process.env.XLSX_PATH || join(__dirname, '../inventario.xlsx');

// Mapeamento de colunas do Excel → Campos do Prisma
const COLUMN_MAP = {
  'patrimonio': 'patrimonio',
  'descricao': 'descricao',
  'valor': 'valor',
  'condicao': 'condicaoOriginal',
  'fornecedor': 'fornecedor',
  'cnpj_fornecedor': 'cnpjFornecedor',
  'catalogo': 'catalogo',
  'codigo_sia': 'codigoSIA',
  'descricao_sia': 'descricaoSIA',
  'numero_entrada': 'numeroEntrada',
  'data_entrada': 'dataEntrada',
  'data_aquisicao': 'dataAquisicao',
  'documento': 'documento',
  'data_documento': 'dataDocumento',
  'tipo_aquisicao': 'tipoAquisicao',
  'você digita a sala': 'spaceName',
  'responsavel': 'spaceResponsible',
  'setor': 'sector',
  'unidade': 'unit',
  'Encontrado': 'statusEncontrado',
  '(estado)': 'estadoOriginal'
};

// Converter valor monetário "R$ 1.234,56" → Decimal
function parseCurrency(value) {
  if (!value) return null;
  const cleaned = value.toString().replace('R$', '').replace(/\./g, '').replace(',', '.').trim();
  const num = parseFloat(cleaned);
  return isNaN(num) ? null : num;
}

// Converter data do Excel (pode vir como número serial ou string)
function parseDate(value) {
  if (!value) return null;
  if (value instanceof Date) return value;
  if (typeof value === 'number') {
    // Excel serial date
    return new Date(Math.round((value - 25569) * 86400 * 1000));
  }
  const date = new Date(value);
  return isNaN(date.getTime()) ? null : date;
}

async function seed() {
  console.log('🚀 Iniciando seed do inventario.xlsx...');

  if (!existsSync(XLSX_PATH)) {
    throw new Error(`Arquivo de inventário não encontrado em: ${XLSX_PATH}`);
  }

  // Ler arquivo Excel
  const buffer = readFileSync(XLSX_PATH);
  const workbook = XLSX.read(buffer, { type: 'buffer', cellDates: true });
  const sheetName = workbook.SheetNames.includes(INVENTORY_SHEET)
    ? INVENTORY_SHEET
    : workbook.SheetNames[0];
  const rawData = XLSX.utils.sheet_to_json(workbook.Sheets[sheetName]);

  console.log(`📄 Lidas ${rawData.length} linhas da aba ${sheetName}`);

  // 1. Extrair espaços únicos da coluna "você digita a sala"
  const spacesMap = new Map();
  for (const row of rawData) {
    const sala = row['você digita a sala']?.toString().trim();
    const setor = row['setor']?.toString().trim();
    const spaceName = sala || setor || 'SEM_LOCAL';
    const responsible = row['responsavel']?.toString().trim() || 'Não informado';
    
    if (!spacesMap.has(spaceName)) {
      spacesMap.set(spaceName, { name: spaceName, responsible });
    }
  }

  console.log(`🏢 Encontrados ${spacesMap.size} espaços únicos`);

  // 2. Criar espaços no banco
  for (const [name, spaceData] of spacesMap) {
    const existingSpace = await prisma.space.findFirst({ where: { name } });

    if (!existingSpace) {
      await prisma.space.create({
        data: {
          name,
          responsible: spaceData.responsible,
          isActive: true,
          isFinalized: false
        }
      });
      continue;
    }

    await prisma.space.update({
      where: { id: existingSpace.id },
      data: { responsible: spaceData.responsible }
    });
  }

  // 3. Criar/atualizar itens
  let created = 0, updated = 0, skipped = 0;
  
  for (const row of rawData) {
    const patrimonio = row['patrimonio']?.toString().trim();
    const sala = row['você digita a sala']?.toString().trim();
    const setor = row['setor']?.toString().trim();
    const spaceName = sala || setor || 'SEM_LOCAL';
    
    if (!patrimonio) {
      skipped++;
      continue;
    }

    // Buscar espaço
    const space = await prisma.space.findFirst({ where: { name: spaceName } });
    if (!space) {
      console.warn(`⚠️ Espaço não encontrado: "${spaceName}" - pulando item ${patrimonio}`);
      skipped++;
      continue;
    }

    // Mapear dados
    const itemData = {
      patrimonio,
      descricao: row['descricao']?.toString() || '',
      valor: parseCurrency(row['valor']),
      condicaoOriginal: row['condicao']?.toString() || '',
      fornecedor: row['fornecedor']?.toString(),
      cnpjFornecedor: row['cnpj_fornecedor']?.toString(),
      catalogo: row['catalogo']?.toString(),
      codigoSIA: row['codigo_sia']?.toString(),
      descricaoSIA: row['descricao_sia']?.toString(),
      numeroEntrada: row['numero_entrada']?.toString(),
      dataEntrada: parseDate(row['data_entrada']),
      dataAquisicao: parseDate(row['data_aquisicao']),
      documento: row['documento']?.toString(),
      dataDocumento: parseDate(row['data_documento']),
      tipoAquisicao: row['tipo_aquisicao']?.toString(),
      spaceId: space.id,
      // Status de conferência (inicial)
      statusEncontrado: row['Encontrado']?.toString().toLowerCase() === 'sim' ? 'SIM' : 'NAO',
      condicaoVisual: null, // Será preenchido durante a conferência
      dataConferencia: null,
      ultimoConferente: null
    };

    // Upsert: cria ou atualiza sem duplicar patrimônio
    const result = await prisma.item.upsert({
      where: { patrimonio },
      update: { ...itemData, updatedAt: new Date() },
      create: itemData
    });

    if (result.createdAt.getTime() === result.updatedAt.getTime()) {
      created++;
    } else {
      updated++;
    }
  }

  // Resumo
  console.log('\n✅ Seed concluído!');
  console.log(`   🆕 Itens criados: ${created}`);
  console.log(`   🔄 Itens atualizados: ${updated}`);
  console.log(`   ⏭️  Itens pulados: ${skipped}`);
  console.log(`   🏢 Espaços registrados: ${spacesMap.size}`);
}

// Executar
seed()
  .catch(err => {
    console.error('❌ Erro no seed:', err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });