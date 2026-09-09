import test from "node:test";
import assert from "node:assert/strict";
import { lineasAExonerar, grupoIvaExento, type LineaIvaBc } from "./bc.ts";

// Quitarle el IVA al pedido en BC (importación): a qué líneas hay que tocarles el
// grupo. Cada línea de esta lista es un PATCH contra Business Central.
//
// El detalle que hace falta tener presente: al LEER, BC devuelve en `taxCode` el VAT
// Identifier ("EXENTO", "IVA13"); el grupo que se ESCRIBE es "EXENTO-BIENES". Los dos
// vocabularios se cruzan acá, así que quien manda es el % que BC ya calcula.

const L = (id: string, code: string, taxCode: string, taxPercent?: number): LineaIvaBc =>
  ({ id, code, taxCode, taxPercent });

const EXENTO = "EXENTO-BIENES";

test("lineasAExonerar: solo las que todavía cobran IVA", () => {
  const lineas = [
    L("a", "M05-0804", "IVA13", 13),
    L("b", "03", "EXENTO", 0),      // el cargo de aduana ya viene sin IVA
    L("c", "M17-0321", "IVA13", 13),
  ];
  assert.deepEqual(lineasAExonerar(lineas, EXENTO).map((l) => l.code), ["M05-0804", "M17-0321"]);
});

// El caso que rompió CP-005254: la línea ya estaba bien y se la iba a PATCHear igual,
// porque "EXENTO" (lo que BC devuelve) no es igual a "EXENTO-BIENES" (lo que se manda).
test("lineasAExonerar: el identifier que BC devuelve cuenta como el grupo", () => {
  assert.deepEqual(lineasAExonerar([L("a", "03", "EXENTO")], EXENTO), []);
});

test("lineasAExonerar: un 0% manda aunque el texto no se parezca", () => {
  assert.deepEqual(lineasAExonerar([L("a", "M05-0804", "NOSUJETOS", 0)], EXENTO), []);
});

test("lineasAExonerar: sin % que mirar, decide el texto", () => {
  const lineas = [L("a", "M05-0804", "EXENTO-BIENES"), L("b", "M05-0805", "IVA13")];
  assert.deepEqual(lineasAExonerar(lineas, EXENTO).map((l) => l.code), ["M05-0805"]);
});

test("lineasAExonerar: una línea sin grupo también hay que ponerla", () => {
  assert.deepEqual(lineasAExonerar([L("a", "M05-0804", "")], EXENTO).map((l) => l.code), ["M05-0804"]);
});

test("lineasAExonerar: sin id no se puede PATCHear, así que no entra", () => {
  assert.deepEqual(lineasAExonerar([L("", "M05-0804", "IVA13", 13)], EXENTO), []);
});

test("lineasAExonerar: todas en cero = nada que escribir en BC", () => {
  const lineas = [L("a", "M05-0804", "EXENTO", 0), L("b", "03", "EXENTO", 0)];
  assert.deepEqual(lineasAExonerar(lineas, EXENTO), []);
});

// Un grupo vacío devolvería TODAS las líneas y les escribiría "" a cada una: eso
// dejaría el pedido sin grupo de IVA en BC. Mejor no tocar nada.
test("lineasAExonerar: sin grupo configurado no se toca ninguna línea", () => {
  assert.deepEqual(lineasAExonerar([L("a", "M05-0804", "IVA13", 13)], "  "), []);
});

test("grupoIvaExento: default EXENTO-BIENES (el código real de taxGroups)", () => {
  const antes = process.env.BC_IVA_GRUPO_EXENTO;
  delete process.env.BC_IVA_GRUPO_EXENTO;
  assert.equal(grupoIvaExento(), "EXENTO-BIENES");
  process.env.BC_IVA_GRUPO_EXENTO = " EXONERADO-BIENES ";
  assert.equal(grupoIvaExento(), "EXONERADO-BIENES");
  if (antes === undefined) delete process.env.BC_IVA_GRUPO_EXENTO;
  else process.env.BC_IVA_GRUPO_EXENTO = antes;
});
