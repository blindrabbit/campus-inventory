-- AlterTable
ALTER TABLE "backup_records"
  ADD COLUMN "contentHash" TEXT,
  ADD COLUMN "dedupCount"  INTEGER NOT NULL DEFAULT 0;
