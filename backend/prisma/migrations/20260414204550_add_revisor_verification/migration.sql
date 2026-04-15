-- AlterTable
ALTER TABLE "items" ADD COLUMN "verificationStatus" TEXT;
ALTER TABLE "items" ADD COLUMN "verifiedAt" DATETIME;
ALTER TABLE "items" ADD COLUMN "verifiedBy" TEXT;

-- CreateTable
CREATE TABLE "verification_rolls" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "spaceId" TEXT NOT NULL,
    "itemIds" TEXT NOT NULL DEFAULT '[]',
    "selectedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "reviewedAt" DATETIME,
    "result" TEXT NOT NULL DEFAULT 'PENDING',
    "reason" TEXT,
    "createdBy" TEXT NOT NULL,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "verification_rolls_spaceId_fkey" FOREIGN KEY ("spaceId") REFERENCES "spaces" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "finalization_history" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "spaceId" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "reason" TEXT,
    "actedBy" TEXT NOT NULL,
    "actedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "finalization_history_spaceId_fkey" FOREIGN KEY ("spaceId") REFERENCES "spaces" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE INDEX "verification_rolls_spaceId_idx" ON "verification_rolls"("spaceId");

-- CreateIndex
CREATE INDEX "finalization_history_spaceId_idx" ON "finalization_history"("spaceId");
