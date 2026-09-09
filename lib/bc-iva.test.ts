import test from "node:test";
import assert from "node:assert/strict";
import { lineasAExonerar, grupoIvaExento, type LineaIvaBc } from "./bc.ts";

// Quitarle el IVA al pedido en BC (importación): a qué líneas hay que tocarles el
// grupo. Cada línea de esta lista es un PATCH contra Business Central, así que las
// que ya están exentas NO tienen que aparecer.

const L = (id: string, code: string, taxCode: string): LineaIvaBc => ({ id, code, taxCode });

test("lineasAExonerar: solo las que no están en el grupo exento", () => {
  const lineas = [
    L("a", "M05-0804", "IVA13"),
    L("b", "03", "EXENTO"),      // el cargo de aduana ya viene exento
    L("c", "M17-0321", "IVA13"),
  ];
  assert.deepEqual(lineasAExonerar(lineas, "EXENTO").map((l) => l.code), ["M05-0804", "M17-0321"]);
});

test("lineasAExonerar: el grupo se compara sin distinguir mayúsculas ni espacios", () => {
  const lineas = [L("a", "M05-0804", " exento "), L("b", "M05-0805", "IVA13")];
  assert.deepEqual(lineasAExonerar(lineas, "EXENTO").map((l) => l.code), ["M05-0805"]);
});

test("lineasAExonerar: una línea sin grupo también hay que ponerla", () => {
  assert.deepEqual(lineasAExonerar([L("a", "M05-0804", "")], "EXENTO").map((l) => l.code), ["M05-0804"]);
});

test("lineasAExonerar: sin id no se puede PATCHear, así que no entra", () => {
  assert.deepEqual(lineasAExonerar([L("", "M05-0804", "IVA13")], "EXENTO"), []);
});

test("lineasAExonerar: todas exentas = nada que escribir en BC", () => {
  const lineas = [L("a", "M05-0804", "EXENTO"), L("b", "03", "EXENTO")];
  assert.deepEqual(lineasAExonerar(lineas, "EXENTO"), []);
});

// Un grupo vacío devolvería TODAS las líneas y les escribiría "" a cada una: eso
// dejaría el pedido sin grupo de IVA en BC. Mejor no tocar nada.
test("lineasAExonerar: sin grupo configurado no se toca ninguna línea", () => {
  assert.deepEqual(lineasAExonerar([L("a", "M05-0804", "IVA13")], "  "), []);
});

test("grupoIvaExento: default EXENTO, y se puede cambiar por entorno", () => {
  const antes = process.env.BC_IVA_GRUPO_EXENTO;
  delete process.env.BC_IVA_GRUPO_EXENTO;
  assert.equal(grupoIvaExento(), "EXENTO");
  process.env.BC_IVA_GRUPO_EXENTO = " EXENTO-BIENES ";
  assert.equal(grupoIvaExento(), "EXENTO-BIENES");
  if (antes === undefined) delete process.env.BC_IVA_GRUPO_EXENTO;
  else process.env.BC_IVA_GRUPO_EXENTO = antes;
});
