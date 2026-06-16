-- Livros de acervo podem ter codigo_barras/exemplar único mesmo quando o
-- patrimônio se repete. Mantemos patrimônio único para itens comuns, sem
-- codigo_barras, preservando a regra patrimonial principal.
DROP INDEX IF EXISTS "items_inventoryId_patrimonio_key";

CREATE INDEX IF NOT EXISTS "items_inventoryId_patrimonio_idx"
  ON "items"("inventoryId", "patrimonio");

CREATE UNIQUE INDEX IF NOT EXISTS "items_inventoryId_patrimonio_sem_codigo_barras_key"
  ON "items"("inventoryId", "patrimonio")
  WHERE "patrimonio" IS NOT NULL AND "codigo_barras" IS NULL;
