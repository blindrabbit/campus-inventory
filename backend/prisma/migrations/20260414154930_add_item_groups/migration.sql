-- CreateTable
CREATE TABLE "item_groups" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "inventoryId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "item_groups_inventoryId_fkey" FOREIGN KEY ("inventoryId") REFERENCES "inventories" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_items" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "patrimonio" TEXT NOT NULL,
    "descricao" TEXT NOT NULL,
    "valor" REAL,
    "condicaoOriginal" TEXT NOT NULL,
    "fornecedor" TEXT,
    "cnpj_fornecedor" TEXT,
    "catalogo" TEXT,
    "codigo_sia" TEXT,
    "descricao_sia" TEXT,
    "numero_entrada" TEXT,
    "data_entrada" DATETIME,
    "data_aquisicao" DATETIME,
    "documento" TEXT,
    "data_documento" DATETIME,
    "tipo_aquisicao" TEXT,
    "inventoryId" TEXT,
    "spaceId" TEXT NOT NULL,
    "lastKnownSpaceId" TEXT,
    "Encontrado" TEXT NOT NULL DEFAULT 'NAO',
    "condicaoVisual" TEXT,
    "dataConferencia" DATETIME,
    "ultimoConferente" TEXT,
    "itemGroupId" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "items_inventoryId_fkey" FOREIGN KEY ("inventoryId") REFERENCES "inventories" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "items_spaceId_fkey" FOREIGN KEY ("spaceId") REFERENCES "spaces" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "items_lastKnownSpaceId_fkey" FOREIGN KEY ("lastKnownSpaceId") REFERENCES "spaces" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "items_itemGroupId_fkey" FOREIGN KEY ("itemGroupId") REFERENCES "item_groups" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_items" ("Encontrado", "catalogo", "cnpj_fornecedor", "codigo_sia", "condicaoOriginal", "condicaoVisual", "createdAt", "dataConferencia", "data_aquisicao", "data_documento", "data_entrada", "descricao", "descricao_sia", "documento", "fornecedor", "id", "inventoryId", "lastKnownSpaceId", "numero_entrada", "patrimonio", "spaceId", "tipo_aquisicao", "ultimoConferente", "updatedAt", "valor") SELECT "Encontrado", "catalogo", "cnpj_fornecedor", "codigo_sia", "condicaoOriginal", "condicaoVisual", "createdAt", "dataConferencia", "data_aquisicao", "data_documento", "data_entrada", "descricao", "descricao_sia", "documento", "fornecedor", "id", "inventoryId", "lastKnownSpaceId", "numero_entrada", "patrimonio", "spaceId", "tipo_aquisicao", "ultimoConferente", "updatedAt", "valor" FROM "items";
DROP TABLE "items";
ALTER TABLE "new_items" RENAME TO "items";
CREATE UNIQUE INDEX "items_inventoryId_patrimonio_key" ON "items"("inventoryId", "patrimonio");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;

-- CreateIndex
CREATE INDEX "item_groups_inventoryId_idx" ON "item_groups"("inventoryId");
