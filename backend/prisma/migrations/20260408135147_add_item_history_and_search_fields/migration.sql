-- CreateTable
CREATE TABLE "users" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "samAccountName" TEXT NOT NULL,
    "fullName" TEXT NOT NULL,
    "role" TEXT NOT NULL DEFAULT 'CONFERENTE',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "spaces" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "responsible" TEXT NOT NULL,
    "sector" TEXT,
    "unit" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "isFinalized" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "items" (
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
    "spaceId" TEXT NOT NULL,
    "lastKnownSpaceId" TEXT,
    "Encontrado" TEXT NOT NULL DEFAULT 'NAO',
    "condicaoVisual" TEXT,
    "dataConferencia" DATETIME,
    "ultimoConferente" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "items_spaceId_fkey" FOREIGN KEY ("spaceId") REFERENCES "spaces" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "items_lastKnownSpaceId_fkey" FOREIGN KEY ("lastKnownSpaceId") REFERENCES "spaces" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "item_history" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "itemId" TEXT NOT NULL,
    "fromSpaceId" TEXT,
    "toSpaceId" TEXT,
    "action" TEXT NOT NULL,
    "reason" TEXT,
    "createdBy" TEXT NOT NULL,
    "metadata" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "item_history_itemId_fkey" FOREIGN KEY ("itemId") REFERENCES "items" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "item_history_fromSpaceId_fkey" FOREIGN KEY ("fromSpaceId") REFERENCES "spaces" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "item_history_toSpaceId_fkey" FOREIGN KEY ("toSpaceId") REFERENCES "spaces" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "relocations" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "itemId" TEXT NOT NULL,
    "fromSpaceId" TEXT NOT NULL,
    "toSpaceId" TEXT NOT NULL,
    "movedBy" TEXT NOT NULL,
    "movedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "pendingConfirm" BOOLEAN NOT NULL DEFAULT true,
    CONSTRAINT "relocations_itemId_fkey" FOREIGN KEY ("itemId") REFERENCES "items" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "relocations_fromSpaceId_fkey" FOREIGN KEY ("fromSpaceId") REFERENCES "spaces" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "relocations_toSpaceId_fkey" FOREIGN KEY ("toSpaceId") REFERENCES "spaces" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateIndex
CREATE UNIQUE INDEX "users_samAccountName_key" ON "users"("samAccountName");

-- CreateIndex
CREATE UNIQUE INDEX "items_patrimonio_key" ON "items"("patrimonio");

-- CreateIndex
CREATE UNIQUE INDEX "relocations_itemId_key" ON "relocations"("itemId");
