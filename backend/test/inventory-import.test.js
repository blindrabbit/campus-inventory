import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { parseInventoryCsv } from "../src/utils/inventory-import.js";

test("parseInventoryCsv aceita o formato CSV de campus aracruz", async () => {
  const buffer = readFileSync(
    new URL(
      "../../arquivos/82434_bens-campus-aracruz_20260415-1935.csv",
      import.meta.url,
    ),
  );

  const result = await parseInventoryCsv(buffer);

  assert.equal(result.valid, true);
  assert.equal(result.sourceFormat, "CSV");
  assert.ok(result.rowCount > 0);
  assert.ok(Array.isArray(result.rows));
  assert.equal(result.rows[0].patrimonio, "8035");
  assert.equal(
    result.rows[0].descricao,
    "ARMARIO DUPLO COM 6 PORTAS. DIMENSOES (LAP): 60X185X45CM. MARCA BICCATECA",
  );
  assert.equal(result.rows[0].setor, "ÁREAS EXTERNAS E DE USO COMUM");
  assert.equal(result.rows[0].responsavel, "LEANDRO BITTI SANTA ANNA");
});
