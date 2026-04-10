import test from "node:test";
import assert from "node:assert/strict";
import { repairMojibake } from "../src/utils/pdf-text.js";

test("repairMojibake corrige texto com dupla codificacao", () => {
  const input = "COORDENADORIA DE COMUNICAÃ‡ÃƒO SOCIAL E EVENTOS";
  const expected = "COORDENADORIA DE COMUNICAÇÃO SOCIAL E EVENTOS";

  assert.equal(repairMojibake(input), expected);
});

test("repairMojibake preserva texto sem mojibake", () => {
  const input = "COORDENADORIA DE COMUNICAÇÃO SOCIAL E EVENTOS";

  assert.equal(repairMojibake(input), input);
});
