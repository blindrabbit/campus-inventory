-- CreateTable
CREATE TABLE "inventories" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "campus" TEXT,
    "sourceType" TEXT NOT NULL DEFAULT 'UPLOAD_XLSX',
    "statusOperacao" TEXT NOT NULL DEFAULT 'NAO_INICIADO',
    "baseInventoryId" TEXT,
    "createdById" TEXT,
    "startedAt" DATETIME,
    "finishedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "inventories_baseInventoryId_fkey" FOREIGN KEY ("baseInventoryId") REFERENCES "inventories" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "inventories_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "users" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "inventory_status_history" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "inventoryId" TEXT NOT NULL,
    "fromStatus" TEXT NOT NULL,
    "toStatus" TEXT NOT NULL,
    "changedBy" TEXT NOT NULL,
    "changedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "inventory_status_history_inventoryId_fkey" FOREIGN KEY ("inventoryId") REFERENCES "inventories" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "inventory_users" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "inventoryId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "role" TEXT NOT NULL DEFAULT 'CONFERENTE',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "inventory_users_inventoryId_fkey" FOREIGN KEY ("inventoryId") REFERENCES "inventories" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "inventory_users_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users" ("id") ON DELETE CASCADE ON UPDATE CASCADE
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
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "items_inventoryId_fkey" FOREIGN KEY ("inventoryId") REFERENCES "inventories" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "items_spaceId_fkey" FOREIGN KEY ("spaceId") REFERENCES "spaces" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "items_lastKnownSpaceId_fkey" FOREIGN KEY ("lastKnownSpaceId") REFERENCES "spaces" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_items" ("Encontrado", "catalogo", "cnpj_fornecedor", "codigo_sia", "condicaoOriginal", "condicaoVisual", "createdAt", "dataConferencia", "data_aquisicao", "data_documento", "data_entrada", "descricao", "descricao_sia", "documento", "fornecedor", "id", "lastKnownSpaceId", "numero_entrada", "patrimonio", "spaceId", "tipo_aquisicao", "ultimoConferente", "updatedAt", "valor") SELECT "Encontrado", "catalogo", "cnpj_fornecedor", "codigo_sia", "condicaoOriginal", "condicaoVisual", "createdAt", "dataConferencia", "data_aquisicao", "data_documento", "data_entrada", "descricao", "descricao_sia", "documento", "fornecedor", "id", "lastKnownSpaceId", "numero_entrada", "patrimonio", "spaceId", "tipo_aquisicao", "ultimoConferente", "updatedAt", "valor" FROM "items";
DROP TABLE "items";
ALTER TABLE "new_items" RENAME TO "items";
CREATE UNIQUE INDEX "items_inventoryId_patrimonio_key" ON "items"("inventoryId", "patrimonio");
CREATE TABLE "new_spaces" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "responsible" TEXT NOT NULL,
    "sector" TEXT,
    "unit" TEXT,
    "inventoryId" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "isFinalized" BOOLEAN NOT NULL DEFAULT false,
    "startedAt" DATETIME,
    "startedBy" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "spaces_inventoryId_fkey" FOREIGN KEY ("inventoryId") REFERENCES "inventories" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_spaces" ("createdAt", "id", "isActive", "isFinalized", "name", "responsible", "sector", "startedAt", "startedBy", "unit", "updatedAt") SELECT "createdAt", "id", "isActive", "isFinalized", "name", "responsible", "sector", "startedAt", "startedBy", "unit", "updatedAt" FROM "spaces";
DROP TABLE "spaces";
ALTER TABLE "new_spaces" RENAME TO "spaces";
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;

-- CreateIndex
CREATE INDEX "inventory_status_history_inventoryId_changedAt_idx" ON "inventory_status_history"("inventoryId", "changedAt");

-- CreateIndex
CREATE INDEX "inventory_users_userId_idx" ON "inventory_users"("userId");

-- CreateIndex
CREATE INDEX "inventory_users_inventoryId_idx" ON "inventory_users"("inventoryId");

-- CreateIndex
CREATE UNIQUE INDEX "inventory_users_inventoryId_userId_key" ON "inventory_users"("inventoryId", "userId");
