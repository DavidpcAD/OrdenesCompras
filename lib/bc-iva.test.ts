import test from "node:test";
import assert from "node:assert/strict";
import { lineasAExonerar, grupoIvaExento, codigosConIvaCero, lineasAPonerEnCero,
  type LineaIvaBc, type LineaReplaceBc } from "./bc.ts";

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

// ── EL 0% DE LA ORDEN VIAJA A BC ───────────────────────────────────────────────
// "Si yo no le pongo IVA, entonces va en 0". El IVA% de la app se quedaba en el
// estimado y en el PDF; ahora, cuando es CERO, se le pone el grupo exento a esa
// línea en BC en el mismo movimiento en que se crean o reescriben las líneas.

const A = (itemNo: string, ivaPct?: number): LineaReplaceBc =>
  ({ tipo: "articulo", itemNo, cantidad: 1, precio: 100, ivaPct });

test("codigosConIvaCero: solo las líneas que dicen 0", () => {
  const lineas = [A("M05-0804", 0), A("M17-0321", 13), A("M20-1088", 0)];
  assert.deepEqual(codigosConIvaCero(lineas), ["M05-0804", "M20-1088"]);
});

// El default de la app es 13: una línea sin ivaPct es una que nadie tocó, no una
// exenta. Si contara como cero, una orden vieja se quedaría sin IVA en BC sola.
test("codigosConIvaCero: sin ivaPct NO es cero", () => {
  assert.deepEqual(codigosConIvaCero([A("M05-0804"), A("M17-0321", 0)]), ["M17-0321"]);
});

test("codigosConIvaCero: la variante no cuenta, el código es el pelado", () => {
  assert.deepEqual(codigosConIvaCero([A("M11-0081 -VAR 12", 0)]), ["M11-0081"]);
});

test("codigosConIvaCero: un cargo entra por su chargeNo", () => {
  const cargo: LineaReplaceBc = { tipo: "cargo", chargeNo: "03", cantidad: 1, precio: 669.04, ivaPct: 0 };
  assert.deepEqual(codigosConIvaCero([cargo]), ["03"]);
});

test("lineasAPonerEnCero: solo las que BC todavía cobra", () => {
  const enBc = [
    { id: "a", code: "M05-0804", taxCode: "IVA13", taxPercent: 13 },
    { id: "b", code: "03", taxCode: "EXENTO", taxPercent: 0 },   // ya está en 0
    { id: "c", code: "M17-0321", taxCode: "IVA13", taxPercent: 13 },  // la orden dice 13
  ];
  assert.deepEqual(lineasAPonerEnCero(["M05-0804", "03"], enBc).map((l) => l.code), ["M05-0804"]);
});

test("lineasAPonerEnCero: sin líneas en cero no se escribe nada en BC", () => {
  const enBc = [{ id: "a", code: "M05-0804", taxCode: "IVA13", taxPercent: 13 }];
  assert.deepEqual(lineasAPonerEnCero([], enBc), []);
});
