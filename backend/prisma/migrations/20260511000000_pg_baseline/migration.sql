-- CreateTable
CREATE TABLE "users" (
    "id" TEXT NOT NULL,
    "samAccountName" TEXT NOT NULL,
    "fullName" TEXT NOT NULL,
    "role" TEXT NOT NULL DEFAULT 'CONFERENTE',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "inventories" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "campus" TEXT,
    "sourceType" TEXT NOT NULL DEFAULT 'UPLOAD_XLSX',
    "statusOperacao" TEXT NOT NULL DEFAULT 'NAO_INICIADO',
    "baseInventoryId" TEXT,
    "createdById" TEXT,
    "startedAt" TIMESTAMP(3),
    "finishedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "inventories_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "inventory_status_history" (
    "id" TEXT NOT NULL,
    "inventoryId" TEXT NOT NULL,
    "fromStatus" TEXT NOT NULL,
    "toStatus" TEXT NOT NULL,
    "changedBy" TEXT NOT NULL,
    "changedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "inventory_status_history_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "inventory_users" (
    "id" TEXT NOT NULL,
    "inventoryId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "role" TEXT NOT NULL DEFAULT 'CONFERENTE',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "inventory_users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "spaces" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "responsible" TEXT NOT NULL,
    "sector" TEXT,
    "unit" TEXT,
    "inventoryId" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "isFinalized" BOOLEAN NOT NULL DEFAULT false,
    "isVerifiedByRevisor" BOOLEAN NOT NULL DEFAULT false,
    "startedAt" TIMESTAMP(3),
    "startedBy" TEXT,
    "observacoes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "spaces_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "items" (
    "id" TEXT NOT NULL,
    "patrimonio" TEXT NOT NULL,
    "descricao" TEXT NOT NULL,
    "valor" DOUBLE PRECISION,
    "condicaoOriginal" TEXT NOT NULL,
    "fornecedor" TEXT,
    "cnpj_fornecedor" TEXT,
    "catalogo" TEXT,
    "codigo_sia" TEXT,
    "descricao_sia" TEXT,
    "numero_entrada" TEXT,
    "data_entrada" TIMESTAMP(3),
    "data_aquisicao" TIMESTAMP(3),
    "documento" TEXT,
    "data_documento" TIMESTAMP(3),
    "tipo_aquisicao" TEXT,
    "inventoryId" TEXT,
    "spaceId" TEXT NOT NULL,
    "lastKnownSpaceId" TEXT,
    "Encontrado" TEXT NOT NULL DEFAULT 'NAO',
    "condicaoVisual" TEXT,
    "dataConferencia" TIMESTAMP(3),
    "ultimoConferente" TEXT,
    "verificationStatus" TEXT,
    "verifiedAt" TIMESTAMP(3),
    "verifiedBy" TEXT,
    "itemGroupId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "item_history" (
    "id" TEXT NOT NULL,
    "itemId" TEXT NOT NULL,
    "fromSpaceId" TEXT,
    "toSpaceId" TEXT,
    "action" TEXT NOT NULL,
    "reason" TEXT,
    "createdBy" TEXT NOT NULL,
    "metadata" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "item_history_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "item_groups" (
    "id" TEXT NOT NULL,
    "inventoryId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "item_groups_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "relocations" (
    "id" TEXT NOT NULL,
    "itemId" TEXT NOT NULL,
    "fromSpaceId" TEXT NOT NULL,
    "toSpaceId" TEXT NOT NULL,
    "movedBy" TEXT NOT NULL,
    "movedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "pendingConfirm" BOOLEAN NOT NULL DEFAULT true,
    "wasUnfound" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "relocations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "verification_rolls" (
    "id" TEXT NOT NULL,
    "spaceId" TEXT NOT NULL,
    "itemIds" TEXT NOT NULL DEFAULT '[]',
    "selectedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "reviewedAt" TIMESTAMP(3),
    "result" TEXT NOT NULL DEFAULT 'PENDING',
    "reason" TEXT,
    "createdBy" TEXT NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "verification_rolls_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "finalization_history" (
    "id" TEXT NOT NULL,
    "spaceId" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "reason" TEXT,
    "actedBy" TEXT NOT NULL,
    "actedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "finalization_history_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "backup_records" (
    "id" TEXT NOT NULL,
    "inventoryId" TEXT NOT NULL,
    "createdBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "label" TEXT,
    "fileName" TEXT NOT NULL,
    "filePath" TEXT NOT NULL,
    "fileSizeBytes" INTEGER NOT NULL DEFAULT 0,
    "status" TEXT NOT NULL DEFAULT 'COMPLETED',
    "errorMessage" TEXT,
    "isScheduled" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "backup_records_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "backup_schedules" (
    "id" TEXT NOT NULL,
    "inventoryId" TEXT NOT NULL,
    "intervalHours" INTEGER NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "lastRunAt" TIMESTAMP(3),
    "nextRunAt" TIMESTAMP(3) NOT NULL,
    "createdBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "backup_schedules_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "system_locks" (
    "id" TEXT NOT NULL,
    "inventoryId" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "lockedBy" TEXT NOT NULL,
    "lockedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "system_locks_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "users_samAccountName_key" ON "users"("samAccountName");

-- CreateIndex
CREATE INDEX "inventory_status_history_inventoryId_changedAt_idx" ON "inventory_status_history"("inventoryId", "changedAt");

-- CreateIndex
CREATE INDEX "inventory_users_userId_idx" ON "inventory_users"("userId");

-- CreateIndex
CREATE INDEX "inventory_users_inventoryId_idx" ON "inventory_users"("inventoryId");

-- CreateIndex
CREATE UNIQUE INDEX "inventory_users_inventoryId_userId_key" ON "inventory_users"("inventoryId", "userId");

-- CreateIndex
CREATE UNIQUE INDEX "items_inventoryId_patrimonio_key" ON "items"("inventoryId", "patrimonio");

-- CreateIndex
CREATE INDEX "item_groups_inventoryId_idx" ON "item_groups"("inventoryId");

-- CreateIndex
CREATE UNIQUE INDEX "relocations_itemId_key" ON "relocations"("itemId");

-- CreateIndex
CREATE INDEX "verification_rolls_spaceId_idx" ON "verification_rolls"("spaceId");

-- CreateIndex
CREATE INDEX "finalization_history_spaceId_idx" ON "finalization_history"("spaceId");

-- CreateIndex
CREATE INDEX "backup_records_inventoryId_createdAt_idx" ON "backup_records"("inventoryId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "backup_schedules_inventoryId_key" ON "backup_schedules"("inventoryId");

-- CreateIndex
CREATE UNIQUE INDEX "system_locks_inventoryId_key" ON "system_locks"("inventoryId");

-- AddForeignKey
ALTER TABLE "inventories" ADD CONSTRAINT "inventories_baseInventoryId_fkey" FOREIGN KEY ("baseInventoryId") REFERENCES "inventories"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inventories" ADD CONSTRAINT "inventories_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inventory_status_history" ADD CONSTRAINT "inventory_status_history_inventoryId_fkey" FOREIGN KEY ("inventoryId") REFERENCES "inventories"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inventory_users" ADD CONSTRAINT "inventory_users_inventoryId_fkey" FOREIGN KEY ("inventoryId") REFERENCES "inventories"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inventory_users" ADD CONSTRAINT "inventory_users_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "spaces" ADD CONSTRAINT "spaces_inventoryId_fkey" FOREIGN KEY ("inventoryId") REFERENCES "inventories"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "items" ADD CONSTRAINT "items_inventoryId_fkey" FOREIGN KEY ("inventoryId") REFERENCES "inventories"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "items" ADD CONSTRAINT "items_spaceId_fkey" FOREIGN KEY ("spaceId") REFERENCES "spaces"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "items" ADD CONSTRAINT "items_lastKnownSpaceId_fkey" FOREIGN KEY ("lastKnownSpaceId") REFERENCES "spaces"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "items" ADD CONSTRAINT "items_itemGroupId_fkey" FOREIGN KEY ("itemGroupId") REFERENCES "item_groups"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "item_history" ADD CONSTRAINT "item_history_itemId_fkey" FOREIGN KEY ("itemId") REFERENCES "items"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "item_history" ADD CONSTRAINT "item_history_fromSpaceId_fkey" FOREIGN KEY ("fromSpaceId") REFERENCES "spaces"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "item_history" ADD CONSTRAINT "item_history_toSpaceId_fkey" FOREIGN KEY ("toSpaceId") REFERENCES "spaces"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "item_groups" ADD CONSTRAINT "item_groups_inventoryId_fkey" FOREIGN KEY ("inventoryId") REFERENCES "inventories"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "relocations" ADD CONSTRAINT "relocations_itemId_fkey" FOREIGN KEY ("itemId") REFERENCES "items"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "relocations" ADD CONSTRAINT "relocations_fromSpaceId_fkey" FOREIGN KEY ("fromSpaceId") REFERENCES "spaces"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "relocations" ADD CONSTRAINT "relocations_toSpaceId_fkey" FOREIGN KEY ("toSpaceId") REFERENCES "spaces"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "verification_rolls" ADD CONSTRAINT "verification_rolls_spaceId_fkey" FOREIGN KEY ("spaceId") REFERENCES "spaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "finalization_history" ADD CONSTRAINT "finalization_history_spaceId_fkey" FOREIGN KEY ("spaceId") REFERENCES "spaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "backup_records" ADD CONSTRAINT "backup_records_inventoryId_fkey" FOREIGN KEY ("inventoryId") REFERENCES "inventories"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "backup_schedules" ADD CONSTRAINT "backup_schedules_inventoryId_fkey" FOREIGN KEY ("inventoryId") REFERENCES "inventories"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "system_locks" ADD CONSTRAINT "system_locks_inventoryId_fkey" FOREIGN KEY ("inventoryId") REFERENCES "inventories"("id") ON DELETE CASCADE ON UPDATE CASCADE;

