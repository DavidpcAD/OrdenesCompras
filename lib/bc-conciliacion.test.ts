// Pruebas del cotejo orden (SQL) ↔ pedido (Business Central).
//
// El caso que hay que sostener es CP-005172: la app tenía 7 líneas, BC 6, y la que
// faltaba eran ₡22.820 de tornillos que el proveedor sí facturó. Si este archivo
// pasa, esa orden no vuelve a pasar por la app sin que alguien lo vea.
//
//   npm test
import { test } from "node:test";
import assert from "node:assert/strict";
import { cotejarLineas, claveLinea, lineasRecibidasDeOrden, type LineaApp, type LineaBc } from "./bc-conciliacion.ts";

const app = (p: Partial<LineaApp> = {}): LineaApp => ({
  id: "1", tipo: "articulo", itemNo: "M06-0116", variantCode: "",
  descripcion: "TORNILLO 1-1/4 P/F", cantidad: 7000, precioUnitario: 3.26, unidad: "UND", ...p,
});

const bc = (p: Partial<LineaBc> = {}): LineaBc => ({
  documentNo: "CP-005172", lineNo: 10000, tipo: "articulo", itemNo: "M06-0116", variantCode: "",
  descripcion: "TORNILLO 1-1/4 P/F", unidad: "UND", almacen: "ALM-GRAL",
  cantidad: 7000, recibida: 0, facturada: 0, pendiente: 7000, precioUnitario: 3.26, ...p,
});

test("orden y pedido iguales: no hay nada que reportar", () => {
  const r = cotejarLineas([app()], [bc()]);
  assert.equal(r.ok, true);
  assert.equal(r.diferencias.length, 0);
  assert.equal(r.resumen, "");
  assert.equal(r.lineasApp, 1);
  assert.equal(r.lineasBc, 1);
});

test("CP-005172: la línea que BC no tiene se reporta con su plata", () => {
  const orden = [
    app({ id: "1", itemNo: "M06-0040", descripcion: "CLAVO ACERO", cantidad: 12, precioUnitario: 5370 }),
    app({ id: "2", itemNo: "M06-0116", cantidad: 7000, precioUnitario: 3.26 }),
  ];
  const pedido = [bc({ itemNo: "M06-0040", descripcion: "CLAVO ACERO", cantidad: 12, precioUnitario: 5370 })];
  const r = cotejarLineas(orden, pedido);
  assert.equal(r.ok, false);
  assert.equal(r.diferencias.length, 1);
  const d = r.diferencias[0];
  assert.equal(d.clase, "falta_en_bc");
  assert.equal(d.itemNo, "M06-0116");
  assert.equal(Math.round(d.importe), 22820);          // ₡22.820, la plata del incidente
  assert.equal(Math.round(r.importeEnJuego), 22820);
  assert.match(r.resumen, /NO tiene 1 línea/);
});

test("una línea que alguien agregó en BC y la orden no tiene", () => {
  const r = cotejarLineas([app()], [bc(), bc({ itemNo: "M99-9999", descripcion: "ALGO", cantidad: 3, precioUnitario: 100 })]);
  assert.equal(r.ok, false);
  assert.equal(r.diferencias[0].clase, "sobra_en_bc");
  assert.equal(r.diferencias[0].itemNo, "M99-9999");
});

test("cantidad distinta: se reporta la diferencia de plata, no la de unidades", () => {
  const r = cotejarLineas([app({ cantidad: 7000 })], [bc({ cantidad: 700 })]);
  assert.equal(r.diferencias[0].clase, "cantidad");
  assert.equal(r.diferencias[0].cantidadApp, 7000);
  assert.equal(r.diferencias[0].cantidadBc, 700);
  assert.equal(Math.round(r.diferencias[0].importe), Math.round(6300 * 3.26));
});

test("precio distinto: salta aunque la cantidad coincida", () => {
  const r = cotejarLineas([app({ precioUnitario: 3.26 })], [bc({ precioUnitario: 3.5 })]);
  assert.equal(r.diferencias[0].clase, "precio");
});

test("el precio se compara con tolerancia de medio céntimo (BC redondea)", () => {
  const r = cotejarLineas([app({ precioUnitario: 3.26 })], [bc({ precioUnitario: 3.262 })]);
  assert.equal(r.ok, true);
});

test("unidad distinta gana sobre todo lo demás: 1 EST no es 1 GR", () => {
  const r = cotejarLineas(
    [app({ itemNo: "M11-0081", cantidad: 1, precioUnitario: 255000, unidad: "EST" })],
    [bc({ itemNo: "M11-0081", cantidad: 1, precioUnitario: 255000, unidad: "GR" })],
  );
  assert.equal(r.diferencias[0].clase, "unidad");
  assert.equal(r.diferencias[0].unidadApp, "EST");
  assert.equal(r.diferencias[0].unidadBc, "GR");
});

test("si un lado no trae unidad, no se inventa una diferencia", () => {
  const r = cotejarLineas([app({ unidad: "UND" })], [bc({ unidad: "" })]);
  assert.equal(r.ok, true);
});

test("el mismo material en dos líneas de la orden se suma antes de comparar", () => {
  // Pasa de verdad: el mismo tornillo para dos almacenes u obras distintas. En BC
  // son dos líneas; comparar de a una daría un falso positivo en cada orden así.
  const orden = [app({ id: "1", cantidad: 3000 }), app({ id: "2", cantidad: 4000 })];
  const pedido = [bc({ lineNo: 10000, cantidad: 3000 }), bc({ lineNo: 20000, cantidad: 4000 })];
  assert.equal(cotejarLineas(orden, pedido).ok, true);
  // …y si BC solo se quedó con una de las dos, sí salta.
  const r = cotejarLineas(orden, [bc({ cantidad: 3000 })]);
  assert.equal(r.diferencias[0].clase, "cantidad");
  assert.equal(r.diferencias[0].cantidadBc, 3000);
});

test("la variante distingue: dos variantes del mismo artículo son dos cosas", () => {
  const orden = [app({ itemNo: "M08-0123", variantCode: "02", cantidad: 2, precioUnitario: 18821 })];
  const pedido = [bc({ itemNo: "M08-0123", variantCode: "01", cantidad: 2, precioUnitario: 18821 })];
  const r = cotejarLineas(orden, pedido);
  assert.equal(r.ok, false);
  assert.equal(r.diferencias[0].clase, "falta_en_bc");   // la 02 no está en BC
  assert.equal(r.diferencias[1].clase, "sobra_en_bc");   // y la 01 está de más
});

test("con la API estándar (sin código de variante) se coteja ignorando la variante", () => {
  // Sin esto, TODA orden con variantes daría falso positivo y la pantalla perdería
  // credibilidad, que es peor que no tenerla.
  const orden = [app({ itemNo: "M08-0123", variantCode: "02", cantidad: 2, precioUnitario: 18821 })];
  const pedido = [bc({ itemNo: "M08-0123", variantCode: "", cantidad: 2, precioUnitario: 18821 })];
  assert.equal(cotejarLineas(orden, pedido).ok, false);
  assert.equal(cotejarLineas(orden, pedido, { ignorarVariante: true }).ok, true);
});

test("la app SIN variante no contradice a BC CON variante (la resuelve en vuelo y no la guarda)", () => {
  // resolverVariantesRequeridas le pone la variante al payload que va a BC pero no la
  // persiste en OrdenCompraDet. Si esto se contara como diferencia, TODA orden con
  // variante daría "falta en BC" + "sobra en BC" por la misma línea.
  const orden = [app({ itemNo: "M08-0123", variantCode: "", cantidad: 2, precioUnitario: 18821 })];
  const pedido = [bc({ itemNo: "M08-0123", variantCode: "02", cantidad: 2, precioUnitario: 18821 })];
  assert.equal(cotejarLineas(orden, pedido).ok, true);
  // …pero la cantidad se sigue comparando contra la suma de TODAS las variantes.
  const dos = [bc({ lineNo: 10000, itemNo: "M08-0123", variantCode: "01", cantidad: 1, precioUnitario: 18821 }),
               bc({ lineNo: 20000, itemNo: "M08-0123", variantCode: "02", cantidad: 1, precioUnitario: 18821 })];
  assert.equal(cotejarLineas(orden, dos).ok, true);
  const r = cotejarLineas(orden, [bc({ itemNo: "M08-0123", variantCode: "02", cantidad: 1, precioUnitario: 18821 })]);
  assert.equal(r.diferencias[0].clase, "cantidad");
  assert.equal(r.diferencias[0].cantidadBc, 1);
});

test("con variante explícita en la app, la variante equivocada de BC SÍ es diferencia", () => {
  const orden = [app({ itemNo: "M08-0123", variantCode: "02", cantidad: 2, precioUnitario: 18821 })];
  const r = cotejarLineas(orden, [bc({ itemNo: "M08-0123", variantCode: "01", cantidad: 2, precioUnitario: 18821 })]);
  assert.equal(r.diferencias.length, 2);
  assert.equal(r.diferencias[0].clase, "falta_en_bc");
  assert.equal(r.diferencias[1].clase, "sobra_en_bc");
});

test("el itemNo con la variante pegada se pela para cotejar", () => {
  // Algunas solicitudes traen "M11-0081 -VAR 12" como código de artículo.
  const r = cotejarLineas([app({ itemNo: "M11-0081 -VAR 12" })], [bc({ itemNo: "M11-0081" })]);
  assert.equal(r.ok, true);
  assert.equal(claveLinea("M11-0081 -VAR 12", ""), "M11-0081");
  assert.equal(claveLinea("m08-0123", "02"), "M08-0123|02");
});

test("las líneas de cargo no se cotejan por plata (BC las reparte)", () => {
  const orden: LineaApp[] = [app(), { id: "9", tipo: "cargo", itemNo: "FLETE", variantCode: "", descripcion: "Transporte", cantidad: 1, precioUnitario: 15000 }];
  const pedido: LineaBc[] = [bc(), { ...bc(), tipo: "cargo", itemNo: "FLETE", descripcion: "Transporte", cantidad: 1, precioUnitario: 0 }];
  assert.equal(cotejarLineas(orden, pedido).ok, true);
  // Pero si el cargo NO está en BC y se pide cotejarlo, se reporta.
  const r = cotejarLineas(orden, [bc()], { soloArticulos: false });
  assert.equal(r.ok, false);
  assert.equal(r.diferencias[0].itemNo, "FLETE");
});

test("un pedido vacío en BC reporta todas las líneas, no una sola", () => {
  const orden = [app({ id: "1" }), app({ id: "2", itemNo: "M06-0040" })];
  const r = cotejarLineas(orden, []);
  assert.equal(r.diferencias.length, 2);
  assert.equal(r.lineasBc, 0);
});

test("lo que falta en BC se reporta primero, y dentro de eso la plata más grande", () => {
  const orden = [
    app({ id: "1", itemNo: "A", cantidad: 1, precioUnitario: 100 }),
    app({ id: "2", itemNo: "B", cantidad: 1, precioUnitario: 90000 }),
    app({ id: "3", itemNo: "C", cantidad: 1, precioUnitario: 500 }),
  ];
  const pedido = [bc({ itemNo: "C", cantidad: 1, precioUnitario: 400 })];
  const r = cotejarLineas(orden, pedido);
  assert.deepEqual(r.diferencias.map((d) => d.itemNo), ["B", "A", "C"]);
  assert.equal(r.diferencias[2].clase, "precio");
});

test("lineasRecibidasDeOrden deja solo lo efectivamente recibido, con esa cantidad", () => {
  const lineas = [
    { ...app({ id: "1", cantidad: 10 }), cantidadRecibida: 4 },
    { ...app({ id: "2", itemNo: "M06-0040", cantidad: 5 }), cantidadRecibida: 0 },
  ];
  const r = lineasRecibidasDeOrden(lineas);
  assert.equal(r.length, 1);
  assert.equal(r[0].cantidad, 4);
});
