/**
 * migrate-spaces-2026.js
 *
 * Atualiza locais do inventário INVENTARIO 2026 (cmoip2pa1000fqxan7055f853):
 *  - Renomeia salas existentes conforme CSV
 *  - Mescla DIRETORIA GERAL DE ARACRUZ → DIRETORIA GERAL DO CAMPUS ARACRUZ
 *  - Cria novos espaços (INCLUIR)
 *  - Corrige nomes já existentes com encoding errado (Sala F5, F9)
 */

import { prisma } from "../src/prisma/client.js";

const INVENTORY_ID = "cmoip2pa1000fqxan7055f853";

// Salas a renomear: [id, nome_novo]
const RENAMES = [
  // COORDENADORIA DE APOIO AO ENSINO → Recepção Ensino - Bloco D
  ["e532f2b3-d1b1-4967-9f89-54878fef38b9", "Recepção Ensino - Bloco D"],
  // COORDENADORIA DE CURSO DE QUÍMICA INDUSTRIAL → Coordenadoria do curso de Química Industrial
  ["e49353ca-3680-4150-b941-d53b927fc693", "Coordenadoria do curso de Química Industrial"],
  // GABINETE DG ARACRUZ → Gabinete da Diretoria Geral
  ["9bbf37fe-4087-4ddd-b491-400b5f370c73", "Gabinete da Diretoria Geral"],
  // LABORATÓRIO DE FABRICAÇÃO MECÂNICA 1 E 2 (GALPÃO) → Laboratório E01 - Fabricação Mecânica
  ["cdf2d06d-84c2-4850-a7cc-af45dc9245a0", "Laboratório E01 - Fabricação Mecânica"],
  // LABORATÓRIO E01 - METROLOGIA → Sala F8 - Laboratório de Metrologia
  ["f8e3142c-e072-4eb1-a296-5810cf36ebee", "Sala F8 - Laboratório de Metrologia"],
  // MINIAUDITÓRIO → Miniauditório - Bloco C
  ["9db9c308-260c-47e3-985d-1590d0c07535", "Miniauditório - Bloco C"],
  // Sala F5 - depósito → Sala F5 - Depósito (corrigir capitalização)
  ["cmori1zru03e0hv1gbjqin205", "Sala F5 - Depósito"],
  // Sala F9 - Deposito → Sala F9 - Depósito (corrigir acento)
  ["cmorernv000oxhv1gim9x8h16", "Sala F9 - Depósito"],
];

// Mescla Diretoria Geral:
// Origem (a ser esvaziada e desativada): DIRETORIA GERAL DE ARACRUZ
const DG_ORIGEM_ID = "1c2488d4-0045-4bb6-850e-6c051fd3d47d";
// Destino (ficará ativa com o novo nome): DIRETORIA GERAL DO CAMPUS ARACRUZ
const DG_DESTINO_ID = "0d9df229-ebe2-4ca2-bb42-3395bc414911";
const DG_NOVO_NOME = "Diretoria Geral";

// Novos espaços (INCLUIR) — nomes já corrigidos do encoding CP850/Windows-1252
// Exclui os que serão criados via rename: "Recepção Ensino - Bloco D" e "Sala F8 - Laboratório de Metrologia"
const NOVOS_ESPACOS = [
  "Antesalas de professores - Bloco C",
  "Antesalas de professores - Bloco D",
  "Apoio - recepção Bloco F",
  "Áreas Externas e de uso comum",
  "Arquivo - Bloco D",
  "Auditório - Bloco F",
  "Bloco A - Áreas Comuns",
  "Bloco B - Áreas comuns",
  "Bloco C - Áreas Comuns",
  "Bloco D - Áreas Comuns",
  "Bloco E - Áreas Comuns",
  "Bloco F - Áreas Comuns",
  "Bloco G - Áreas Comuns",
  "Cantina",
  "Casa de gases Bloco C",
  "Casa de gases Bloco D",
  "Centro Acadêmico e Atléticas - Bloco F",
  "Centro de Processamento de Dados - CPD - Bloco B",
  "Centro de Processamento de Dados - CPD - Bloco F",
  "Coordenadoria de Estágios",
  "Coordenadoria de Laboratórios - Mecânica",
  "Coordenadoria de Laboratórios - Química",
  "Copa Servidores - Bloco D",
  "Cozinha Alunos - Bloco E",
  "Cozinha Servidores - Bloco A",
  "Cozinha Servidores - Bloco B",
  "Cozinha Servidores - Bloco C",
  "Cozinha Servidores - Bloco D",
  "Cozinha terceirizadas - Bloco G",
  "Depósito - Almoxarifado e Patrimônio (Bloco B)",
  "Depósito - Bloco F (andar inferior)",
  "Depósito - Containers",
  "Depósito - Escada Bloco C",
  "Depósito - Escada Bloco D",
  "Depósito - Livros Bloco G",
  "Depósito - TI (Bloco G)",
  "Educação Física - Bloco F",
  "Grêmio Estudantil - Bloco D",
  "Laboratório Araero - Bloco G",
  "Laboratório de Ciências - Bloco F",
  "Laboratório de Robótica - Bloco G",
  "Laboratório Maker - Bloco G",
  "Limpeza - Bloco G",
  "Livros - Biblioteca",
  "Manutenção Predial - Bloco G",
  "Núcleo de Tecnologias Educacionais (NTE) - Bloco G",
  "Reagentes Químicos - Acesso restrito",
  "Sala de Aula C1",
  "Sala de Aula C2",
  "Sala de Aula C3",
  "Sala de Aula C4",
  "Sala de Aula C5",
  "Sala de Aula C6",
  "Sala de Aula D1",
  "Sala de Aula D2",
  "Sala de Aula D3",
  "Sala de Aula D4",
  "Sala de Aula D5",
  "Sala de Aula D6",
  "Sala de Aula D7",
  "Sala de Aula D8",
  "Sala de Aula F1",
  "Sala de Aula F2",
  "Sala de Aula F3",
  "Sala de Aula F7",
  "Sala F4 - Incubadora",
  "Sala F6 - Laboratório de Simulação Numérica",
  "Subestação - Alta tensão",
  "Subestação - Fotovoltaica e QGBT",
];

function normalizeForCompare(str) {
  return str
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .trim();
}

async function run() {
  console.log("=== Migração de Espaços - INVENTARIO 2026 ===\n");

  // 1. Mescla Diretoria Geral
  console.log("--- 1. Mesclando Diretoria Geral ---");
  const itemsOrigem = await prisma.item.count({ where: { spaceId: DG_ORIGEM_ID } });
  console.log(`  Migrando ${itemsOrigem} itens de 'DIRETORIA GERAL DE ARACRUZ' → 'DIRETORIA GERAL DO CAMPUS ARACRUZ'`);

  await prisma.item.updateMany({
    where: { spaceId: DG_ORIGEM_ID },
    data: { spaceId: DG_DESTINO_ID },
  });

  // Renomear destino para Diretoria Geral
  await prisma.space.update({
    where: { id: DG_DESTINO_ID },
    data: { name: DG_NOVO_NOME },
  });
  console.log(`  ✓ Renomeado: DIRETORIA GERAL DO CAMPUS ARACRUZ → '${DG_NOVO_NOME}'`);

  // Desativar origem (agora vazia)
  await prisma.space.update({
    where: { id: DG_ORIGEM_ID },
    data: { isActive: false },
  });
  console.log(`  ✓ Desativado: DIRETORIA GERAL DE ARACRUZ (agora vazia)\n`);

  // 2. Renomear espaços existentes
  console.log("--- 2. Renomeando espaços existentes ---");
  for (const [id, novoNome] of RENAMES) {
    const space = await prisma.space.findUnique({ where: { id }, select: { name: true } });
    if (!space) {
      console.log(`  ⚠ Não encontrado: ${id}`);
      continue;
    }
    await prisma.space.update({ where: { id }, data: { name: novoNome } });
    console.log(`  ✓ '${space.name}' → '${novoNome}'`);
  }
  console.log();

  // 3. Criar novos espaços (INCLUIR)
  console.log("--- 3. Criando novos espaços ---");

  // Buscar todos os nomes existentes para evitar duplicatas
  const existentes = await prisma.space.findMany({
    where: { inventoryId: INVENTORY_ID },
    select: { name: true },
  });
  const nomesExistentes = new Set(existentes.map((s) => normalizeForCompare(s.name)));

  let criados = 0;
  let pulados = 0;

  for (const nome of NOVOS_ESPACOS) {
    const normalizado = normalizeForCompare(nome);
    if (nomesExistentes.has(normalizado)) {
      console.log(`  ~ Já existe (pulando): '${nome}'`);
      pulados++;
      continue;
    }
    await prisma.space.create({
      data: {
        name: nome,
        responsible: "Não informado",
        inventoryId: INVENTORY_ID,
      },
    });
    nomesExistentes.add(normalizado);
    console.log(`  ✓ Criado: '${nome}'`);
    criados++;
  }

  console.log(`\n  Total criados: ${criados}, pulados (já existiam): ${pulados}`);

  // 4. Resumo final
  console.log("\n--- Resumo final ---");
  const totalAtivos = await prisma.space.count({
    where: { inventoryId: INVENTORY_ID, isActive: true },
  });
  const totalInativos = await prisma.space.count({
    where: { inventoryId: INVENTORY_ID, isActive: false },
  });
  console.log(`  Espaços ativos: ${totalAtivos}`);
  console.log(`  Espaços inativos: ${totalInativos}`);
  console.log("\n=== Migração concluída ===");
}

run()
  .catch((e) => {
    console.error("ERRO:", e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
