ALTER TABLE "items" ADD COLUMN "is_duplicate_suspect" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "items" ADD COLUMN "duplicate_notes" TEXT;
ALTER TABLE "items" ADD COLUMN "duplicate_observed_space_id" TEXT;

ALTER TABLE "items" ADD CONSTRAINT "items_duplicate_observed_space_id_fkey" FOREIGN KEY ("duplicate_observed_space_id") REFERENCES "spaces"("id") ON DELETE SET NULL ON UPDATE CASCADE;
