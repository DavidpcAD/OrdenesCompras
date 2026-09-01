// Pruebas de la VARIANTE del material. El caso real que las motivó: la solicitud
// PED-000059 pedía "M12-0014 · PORCELANATO 60X60CM" y Proveeduría no podía saber
// cuál porcelanato era, ni el proveedor cotizarlo; y un zapato de seguridad que en
// BC existe por talla no se podía pedir en dos tallas desde una sola línea.
//
//   npm test
import { test } from "node:test";
import assert from "node:assert/strict";
import { claveVariante, nombreDeVariante, etiquetaVariante, faltaVariante, descripcionParaDocumento } from "./variantes.ts";
import { agruparVariantes } from "./bc.ts";
import { repartoDeLineaSolicitud } from "./helpers.ts";
import type { PedidoLinea } from "./types.ts";

// ─────────────────────────────────────────────── clave y nombre de la variante
test("claveVariante: normaliza el ítem (que puede traer la variante pegada) y el código", () => {
  assert.equal(claveVariante("M12-0014", "0042"), "M12-0014|0042");
  // El itemNo de una solicitud puede venir como "M11-0081 -VAR 12": BC solo conoce
  // "M11-0081", así que la clave se corta en el primer espacio.
  assert.equal(claveVariante("M11-0081 -VAR 12", "var 12"), "M11-0081|VAR 12");
  assert.equal(claveVariante(" m12-0014 ", " 0042 "), "M12-0014|0042");
});

test("nombreDeVariante: lo encuentra sin importar mayúsculas; sin código no busca nada", () => {
  const nombres = { "M12-0014|0042": "PORCELANATO BEIGE RECTIFICADO" };
  assert.equal(nombreDeVariante(nombres, "m12-0014", "0042"), "PORCELANATO BEIGE RECTIFICADO");
  assert.equal(nombreDeVariante(nombres, "M12-0014", ""), "");
  assert.equal(nombreDeVariante(nombres, "M12-0014", "0043"), "");
  assert.equal(nombreDeVariante({}, "M12-0014", "0042"), "");
});

test("etiquetaVariante: código + nombre, y solo el código cuando BC no lo dio", () => {
  assert.equal(etiquetaVariante("0042", "ZAPATO … NO. 42"), "0042 — ZAPATO … NO. 42");
  assert.equal(etiquetaVariante("0042", ""), "0042");
  // BC copia el código como descripción cuando nadie le puso nombre: no se repite.
  assert.equal(etiquetaVariante("0042", "0042"), "0042");
  assert.equal(etiquetaVariante("", "cualquiera"), "");
  assert.equal(etiquetaVariante(undefined, undefined), "");
});

test("faltaVariante: falta solo si hay MÁS de una y la línea no dice cuál", () => {
  const dos = [{ code: "39", descripcion: "T39" }, { code: "42", descripcion: "T42" }];
  assert.equal(faltaVariante("", dos), true);
  assert.equal(faltaVariante("42", dos), false);
  // Con una sola no hay nada que elegir, y sin catálogo (BC caído) no se puede
  // afirmar que falte: se calla en vez de alarmar.
  assert.equal(faltaVariante("", [{ code: "39", descripcion: "T39" }]), false);
  assert.equal(faltaVariante("", []), false);
});

test("descripcionParaDocumento: la variante va DEBAJO del material, y sin variante no agrega nada", () => {
  // Es lo que lee el proveedor: "PORCELANATO 60X60CM" a secas no se puede cotizar.
  assert.equal(
    descripcionParaDocumento("PORCELANATO 60X60CM", "0042 — BEIGE RECTIFICADO"),
    "PORCELANATO 60X60CM\nVariante: 0042 — BEIGE RECTIFICADO",
  );
  assert.equal(descripcionParaDocumento("VARILLA DEFORME #3", ""), "VARILLA DEFORME #3");
  assert.equal(descripcionParaDocumento("", ""), "—");
  assert.equal(descripcionParaDocumento(undefined, "STD"), "—\nVariante: STD");
});

// ─────────────────────────────────── agrupar la respuesta en lote de itemVariants
test("agruparVariantes: reparte las filas por ítem y deja en [] al que no tiene", () => {
  const g = agruparVariantes([
    { itemNumber: "M12-0014", code: "0042", description: "BEIGE" },
    { itemNumber: "M12-0014", code: "0043", description: "GRIS" },
    { itemNumber: "M16-0185", code: "39", description: "T39" },
  ], ["M12-0014", "M16-0185", "M01-0001"]);
  assert.ok(g);
  assert.deepEqual(g!["M12-0014"].map((v) => v.code), ["0042", "0043"]);
  assert.deepEqual(g!["M16-0185"].map((v) => v.descripcion), ["T39"]);
  assert.deepEqual(g!["M01-0001"], []);   // preguntado y sin variantes
});

test("agruparVariantes: con un solo ítem no necesita que la respuesta lo repita", () => {
  const g = agruparVariantes([{ code: "39", description: "T39" }], ["M16-0185"]);
  assert.deepEqual(g?.["M16-0185"].map((v) => v.code), ["39"]);
});

test("agruparVariantes: si la respuesta no dice de qué ítem es y se preguntó por varios, no adivina", () => {
  const g = agruparVariantes([{ code: "39", description: "T39" }], ["M16-0185", "M12-0014"]);
  assert.equal(g, null);
});

test("agruparVariantes: ignora un ítem que no se preguntó", () => {
  const g = agruparVariantes([{ itemNumber: "M99-9999", code: "X", description: "X" }], ["M12-0014"]);
  assert.deepEqual(g?.["M12-0014"], []);
  assert.equal("M99-9999" in (g ?? {}), false);
});

// ───────────────────────────── reparto de una línea de solicitud entre variantes
const linea = (p: Partial<PedidoLinea> = {}): PedidoLinea => ({
  id: "1", articuloId: "M16-0185", descripcion: "ZAPATO SEGURIDAD", cantidad: 10, unidad: "PAR",
  almacen: "ALM-SEG", cantidadOrdenada: 0, ...p,
});

test("repartoDeLineaSolicitud: suma todas las filas de la misma línea de solicitud", () => {
  const r = repartoDeLineaSolicitud([{ cantidad: "2", unidad: "PAR" }, { cantidad: 3, unidad: "PAR" }], linea());
  assert.equal(r.total, 5);
  assert.equal(r.pendiente, 10);
  assert.equal(r.unidad, "PAR");
});

test("repartoDeLineaSolicitud: el pendiente descuenta lo ya ordenado", () => {
  const r = repartoDeLineaSolicitud([{ cantidad: "4", unidad: "par" }], linea({ cantidadOrdenada: 6 }));
  assert.equal(r.pendiente, 4);
});

test("repartoDeLineaSolicitud: cantidades vacías o con texto valen 0, no NaN", () => {
  const r = repartoDeLineaSolicitud([{ cantidad: "", unidad: "PAR" }, { cantidad: "x", unidad: "PAR" }], linea());
  assert.equal(r.total, 0);
});

test("repartoDeLineaSolicitud: en otra unidad de compra NO compara (255.000 GR = 1 EST)", () => {
  // La solicitud pidió gramos y Proveeduría compra por estañón: comparar 1 contra
  // 255.000 diría "se pasó" o "falta" según el lado, y las dos cosas serían falsas.
  const gr = linea({ unidad: "GR", cantidad: 255000 });
  assert.equal(repartoDeLineaSolicitud([{ cantidad: "1", unidad: "EST" }], gr).pendiente, null);
  assert.equal(repartoDeLineaSolicitud([{ cantidad: "1", unidad: "EST" }], gr).total, 1);
  // Mezcla de unidades entre las filas partidas: tampoco se compara.
  assert.equal(repartoDeLineaSolicitud([{ cantidad: "1", unidad: "GR" }, { cantidad: "1", unidad: "EST" }], gr).pendiente, null);
});

test("repartoDeLineaSolicitud: sin línea de solicitud (fila manual) no hay con qué comparar", () => {
  const r = repartoDeLineaSolicitud([{ cantidad: "5", unidad: "UND" }], null);
  assert.equal(r.total, 5);
  assert.equal(r.pendiente, null);
});

test("repartoDeLineaSolicitud: una línea devuelta al ingeniero no tiene nada que repartir", () => {
  const r = repartoDeLineaSolicitud([{ cantidad: "1", unidad: "PAR" }], linea({ devuelta: true }));
  assert.equal(r.pendiente, 0);
});
