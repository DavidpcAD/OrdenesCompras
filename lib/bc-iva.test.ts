import test from "node:test";
import assert from "node:assert/strict";
import { lineasAExonerar, grupoIvaExento, ivaDecididoPorCodigo, lineasConIvaDistinto,
  grupoIvaDeTasa, familiaDeGrupoIva, tasasIvaDisponibles, bcPideAbierto,
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

// El "no" que dio BC en CP-005636 (22 sep 2026, FBG SRL, importación de Italia) al
// intentar ponerle el grupo exento a una línea. El pedido estaba LANZADO allá, y el
// estado que devuelve la API estándar decía "Open", así que preguntarlo no sirve: el
// único que dice la verdad es este error. Tiene que reconocerse para que la app
// des-lance el pedido, le cambie el IVA y lo vuelva a lanzar, en vez de rendirse.
test("el rechazo del PATCH de IVA por pedido lanzado se reconoce (CP-005636)", () => {
  const real = "Status must be equal to 'Open'  in Purchase Header: Document Type=Order, No.=CP-005636. Current value is 'Released'.";
  assert.equal(bcPideAbierto(real), true);
  // Un rechazo por otra cosa NO puede des-lanzar un pedido aprobado.
  assert.equal(bcPideAbierto(`Internal_InvalidTableRelation: ... contains a value (EXENTO) that cannot be found`), false);
});

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

// ── EL IVA DE LA ORDEN VIAJA A BC ──────────────────────────────────────────────
// "Si yo le pongo 1%, en BC tiene que salir 1%". El IVA% de la app se quedaba en el
// estimado y en el PDF —solo el 0 viajaba—; ahora cualquier % que sea una DECISIÓN
// se le escribe a la línea en BC en el mismo movimiento en que se crean o se
// reescriben las líneas.

const A = (itemNo: string, ivaPct?: number): LineaReplaceBc =>
  ({ tipo: "articulo", itemNo, cantidad: 1, precio: 100, ivaPct });

test("ivaDecididoPorCodigo: viaja lo que no es el default (0, 1, 4…)", () => {
  const lineas = [A("M05-0804", 0), A("M17-0321", 13), A("M20-1088", 1), A("M11-0500", 4)];
  assert.deepEqual(ivaDecididoPorCodigo(lineas).porCodigo,
    { "M05-0804": 0, "M20-1088": 1, "M11-0500": 4 });
});

// EL CASO DE CP-005814: dos líneas en 1%. Antes solo el 0 viajaba y las dos quedaban
// a merced del grupo del artículo en BC (una salió 1%, la otra 13%).
test("ivaDecididoPorCodigo: el 1% de CP-005814 viaja (antes no)", () => {
  const { porCodigo } = ivaDecididoPorCodigo([A("M17-0051", 1), A("M17-0043", 1), A("M17-0032", 13)]);
  assert.deepEqual(porCodigo, { "M17-0051": 1, "M17-0043": 1 });
});

// El default de la app es 13: una línea sin ivaPct es una que nadie tocó. Empujar 13
// le pisaría en BC los artículos que Contabilidad tiene en 1%, 2% o 4%.
test("ivaDecididoPorCodigo: el default (13) y el campo vacío NO viajan", () => {
  assert.deepEqual(ivaDecididoPorCodigo([A("M05-0804"), A("M17-0321", 13)]).porCodigo, {});
});

test("ivaDecididoPorCodigo: la variante no cuenta, el código es el pelado", () => {
  assert.deepEqual(ivaDecididoPorCodigo([A("M11-0081 -VAR 12", 0)]).porCodigo, { "M11-0081": 0 });
});

test("ivaDecididoPorCodigo: un cargo entra por su chargeNo", () => {
  const cargo: LineaReplaceBc = { tipo: "cargo", chargeNo: "03", cantidad: 1, precio: 669.04, ivaPct: 0 };
  assert.deepEqual(ivaDecididoPorCodigo([cargo]).porCodigo, { "03": 0 });
});

// Las líneas de la app y las de BC se casan por código. El mismo artículo dos veces
// con IVA distinto no se puede resolver allá: no se toca ninguna y se avisa.
test("ivaDecididoPorCodigo: el mismo código con dos IVA queda ambiguo", () => {
  const r = ivaDecididoPorCodigo([A("M05-0804", 1), A("M05-0804", 4), A("M20-1088", 0)]);
  assert.deepEqual(r.ambiguos, ["M05-0804"]);
  assert.deepEqual(r.porCodigo, { "M20-1088": 0 });
});

// Y el choque contra el DEFAULT también es ambiguo: una línea en 1% y otra sin tocar
// no se distinguen en BC, así que empujar el 1% a las dos sería inventar.
test("ivaDecididoPorCodigo: 1% en una línea y el default en otra también es ambiguo", () => {
  const r = ivaDecididoPorCodigo([A("M05-0804", 1), A("M05-0804")]);
  assert.deepEqual(r.ambiguos, ["M05-0804"]);
  assert.deepEqual(r.porCodigo, {});
});

test("lineasConIvaDistinto: solo las que BC calcula distinto", () => {
  const enBc = [
    { id: "a", code: "M05-0804", taxCode: "IVA13", taxPercent: 13 },  // la orden dice 0
    { id: "b", code: "03", taxCode: "EXENTO", taxPercent: 0 },        // ya coincide
    { id: "c", code: "M17-0051", taxCode: "IVA13", taxPercent: 13 },  // la orden dice 1
    { id: "d", code: "M17-0321", taxCode: "IVA13", taxPercent: 13 },  // la orden no decidió
  ];
  assert.deepEqual(
    lineasConIvaDistinto({ "M05-0804": 0, "03": 0, "M17-0051": 1 }, enBc).map((p) => [p.linea.code, p.pct]),
    [["M05-0804", 0], ["M17-0051", 1]]);
});

test("lineasConIvaDistinto: sin nada decidido no se escribe en BC", () => {
  const enBc = [{ id: "a", code: "M05-0804", taxCode: "IVA13", taxPercent: 13 }];
  assert.deepEqual(lineasConIvaDistinto({}, enBc), []);
});

// Escribir un grupo se hace con el NOMBRE de `taxGroups`, y la familia importa: el
// grupo de un servicio manda el IVA a otra cuenta que el de un bien.
test("grupoIvaDeTasa: arma el nombre del grupo y conserva la familia", () => {
  assert.equal(grupoIvaDeTasa(1), "IVA1%-BIENES");
  assert.equal(grupoIvaDeTasa(13, "SERV"), "IVA13%-SERV");
  assert.equal(grupoIvaDeTasa(4, "BIECAP"), "IVA4%-BIECAP");
  assert.equal(grupoIvaDeTasa(0), "EXENTO-BIENES");
  assert.equal(grupoIvaDeTasa(0, "SERV"), "EXENTO-SERV");
});

test("familiaDeGrupoIva: lo que va después del guion", () => {
  assert.equal(familiaDeGrupoIva("IVA13%-BIENES"), "BIENES");
  assert.equal(familiaDeGrupoIva("EXENTO-SERV"), "SERV");
  assert.equal(familiaDeGrupoIva("IVA13"), "");   // el identifier, no el grupo
  assert.equal(familiaDeGrupoIva(undefined), "");
});

// Para que "ese % no existe en BC" diga qué SÍ se puede poner. Son los grupos reales
// de la compañía (21 en ADELANTE_DESARROLLOS_NUEVA, 30 sep 2026).
test("tasasIvaDisponibles: los % de esa familia, el exento como 0", () => {
  const grupos = ["EXENTO-BIENES", "EXENTO-SERV", "IVA1%-BIENES", "IVA2%-BIENES",
    "IVA4%-BIENES", "IVA13%-BIENES", "IVA13%-SERV", "IVA3%-BIECAP", "RET-SALA10"];
  assert.deepEqual(tasasIvaDisponibles(grupos, "BIENES"), [0, 1, 2, 4, 13]);
  assert.deepEqual(tasasIvaDisponibles(grupos, "SERV"), [0, 13]);
  assert.deepEqual(tasasIvaDisponibles(grupos, "BIECAP"), [3]);
});
