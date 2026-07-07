/**
 * One-time fix: os microcomputadores HP EliteDesk (patrimônio 7115-7119) só
 * existiam no INVENTARIO TESTE 2026 (cancelado). O acervo de livros importado
 * para o INVENTARIO 2026 reaproveitou os mesmos números de patrimônio (usando
 * codigoBarras como identificador). Este script cria cópias desses 5 itens no
 * inventário ativo, sem alterar nada no inventário de teste.
 *
 * Run: node scripts/copy-microcomputadores-inventario-2026.js
 */
import { prisma } from "../src/prisma/client.js";

const SOURCE_INVENTORY_ID = "cmp2tc5kl0042atpuf941o34o"; // INVENTARIO TESTE 2026
const TARGET_INVENTORY_ID = "cmoip2pa1000fqxan7055f853"; // INVENTARIO 2026 (ativo)
const TARGET_SPACE_ID = "366fc22f-44e0-4f6f-b53d-390624998ae0"; // LABORATORIO D02 - AUTOCAD no inventário ativo
const PATRIMONIOS = ["7115", "7116", "7117", "7118", "7119"];

const targetSpace = await prisma.space.findFirst({
  where: { id: TARGET_SPACE_ID, inventoryId: TARGET_INVENTORY_ID },
});
if (!targetSpace) {
  throw new Error("Sala de destino não encontrada no inventário ativo.");
}

const sourceItems = await prisma.item.findMany({
  where: { inventoryId: SOURCE_INVENTORY_ID, patrimonio: { in: PATRIMONIOS } },
});

if (sourceItems.length !== PATRIMONIOS.length) {
  throw new Error(
    `Esperava ${PATRIMONIOS.length} itens de origem, encontrei ${sourceItems.length}.`,
  );
}

const created = [];
for (const source of sourceItems) {
  const item = await prisma.item.create({
    data: {
      patrimonio: source.patrimonio,
      descricao: source.descricao,
      valor: source.valor,
      condicaoOriginal: source.condicaoOriginal,
      fornecedor: source.fornecedor,
      cnpjFornecedor: source.cnpjFornecedor,
      catalogo: source.catalogo,
      codigoSIA: source.codigoSIA,
      descricaoSIA: source.descricaoSIA,
      numeroEntrada: source.numeroEntrada,
      dataEntrada: source.dataEntrada,
      dataAquisicao: source.dataAquisicao,
      documento: source.documento,
      dataDocumento: source.dataDocumento,
      tipoAquisicao: source.tipoAquisicao,
      inventoryId: TARGET_INVENTORY_ID,
      spaceId: TARGET_SPACE_ID,
      statusEncontrado: "NAO",
    },
  });
  created.push(item);
  console.log(`Criado ${item.patrimonio} → ${item.id}`);
}

console.log(`${created.length} item(ns) criado(s) em INVENTARIO 2026 / ${targetSpace.name}.`);
await prisma.$disconnect();
