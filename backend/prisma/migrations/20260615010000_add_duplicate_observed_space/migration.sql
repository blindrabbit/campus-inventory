ALTER TABLE "items" ADD COLUMN IF NOT EXISTS "duplicate_observed_space_id" TEXT;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'items_duplicate_observed_space_id_fkey'
  ) THEN
    ALTER TABLE "items"
      ADD CONSTRAINT "items_duplicate_observed_space_id_fkey"
      FOREIGN KEY ("duplicate_observed_space_id")
      REFERENCES "spaces"("id")
      ON DELETE SET NULL
      ON UPDATE CASCADE;
  END IF;
END $$;
