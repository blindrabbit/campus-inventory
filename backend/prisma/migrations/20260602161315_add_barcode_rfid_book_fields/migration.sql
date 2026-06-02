-- AlterTable: patrimônio passa a ser nullable (livros de acervo sem número de patrimônio)
ALTER TABLE "items" ALTER COLUMN "patrimonio" DROP NOT NULL;

-- AlterTable: novos campos de identificação para itens do acervo bibliográfico
ALTER TABLE "items"
  ADD COLUMN "codigo_barras"   TEXT,
  ADD COLUMN "codigo_rfid"     TEXT,
  ADD COLUMN "numero_exemplar" TEXT,
  ADD COLUMN "codigo_exemplar" TEXT,
  ADD COLUMN "autores"         TEXT,
  ADD COLUMN "ano_publicacao"  TEXT;

-- CreateIndex: código de barras único por inventário
-- (NULL != NULL no PostgreSQL → múltiplos itens sem código de barras são permitidos)
CREATE UNIQUE INDEX "items_inventoryId_codigoBarras_key"
  ON "items"("inventoryId", "codigo_barras");
