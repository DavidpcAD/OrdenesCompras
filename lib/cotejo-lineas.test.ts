// LO QUE SE LE DA DE COMER AL COTEJO.
//
// `chequearOrdenContraBc` compara la orden de la app contra el pedido de BC, y de
// ahí salen los avisos de "falta en BC" y "el precio no cuadra" (ver los casos
// CP-005172 y CP-005579). Si la traducción de las líneas se equivoca, el cotejo
// miente en las dos direcciones: acusa diferencias que no existen o se calla una
// de verdad. Estas dos funciones son esa traducción, y son puras.
import { test } from "node:test";
import assert from "node:assert/strict";
import { lineasOrdenParaCotejo, lineasReplaceParaCotejo } from "./bc.ts";
import type { OrdenLinea } from "./types.ts";

const linea = (o: Partial<OrdenLinea> = {}): OrdenLinea => ({
  id: "l1", tipo: "articulo", articuloId: "M11-0081", descripcion: "Material",
  cantidad: 10, unidad: "UND", almacen: "ALM-GRAL", precioUnitario: 100, ivaPct: 13,
  cantidadRecibida: 0, cantidadFacturada: 0, ...o,
} as OrdenLinea);

test("una línea de CARGO se identifica por su chargeNo, no por el artículo", () => {
  // El flete no tiene artículo: si se leyera articuloId, iría vacío al cotejo y
  // BC la vería como una línea que la app "no tiene".
  const [r] = lineasOrdenParaCotejo([linea({ tipo: "cargo", chargeNo: "FLETE", articuloId: "" } as any)]);
  assert.equal(r.itemNo, "FLETE");
  assert.equal(r.tipo, "cargo");
});

test("las demás se identifican por el artículo", () => {
  const [r] = lineasOrdenParaCotejo([linea({ tipo: "articulo", articuloId: "M11-0081" })]);
  assert.equal(r.itemNo, "M11-0081");
});

test("la UNIDAD siempre viaja: sin ella no se ve el error más caro", () => {
  // La misma cantidad en otra unidad: 1 EST son 255.000 GR. Si la unidad no llega,
  // el cotejo compara 1 contra 1 y dice que está todo bien.
  const [r] = lineasOrdenParaCotejo([linea({ unidad: "EST", cantidad: 1 })]);
  assert.equal(r.unidad, "EST");
});

test("el itemNo se deja CRUDO, con la variante pegada si viene así", () => {
  // Pelarla es trabajo de `claveLinea` en el cotejo; hacerlo acá le sacaría el dato.
  const [r] = lineasOrdenParaCotejo([linea({ articuloId: "M11-0081 -VAR 12" })]);
  assert.equal(r.itemNo, "M11-0081 -VAR 12");
});

test("lo que falta queda en cadena vacía y en cero, nunca en undefined ni NaN", () => {
  const [r] = lineasOrdenParaCotejo([linea({
    articuloId: undefined, descripcion: undefined, variantCode: undefined,
    cantidad: undefined, precioUnitario: undefined, unidad: undefined,
  } as any)]);
  assert.deepEqual(
    { itemNo: r.itemNo, descripcion: r.descripcion, variantCode: r.variantCode, unidad: r.unidad },
    { itemNo: "", descripcion: "", variantCode: "", unidad: "" },
  );
  assert.equal(r.cantidad, 0);
  assert.equal(r.precioUnitario, 0);
});

test("una lista vacía o ausente no revienta: devuelve vacío", () => {
  assert.deepEqual(lineasOrdenParaCotejo([]), []);
  assert.deepEqual(lineasOrdenParaCotejo(undefined as any), []);
  assert.deepEqual(lineasReplaceParaCotejo(undefined as any), []);
});

test("el id de la línea de la app se conserva: es con el que se la nombra después", () => {
  const rs = lineasOrdenParaCotejo([linea({ id: "abc" }), linea({ id: "def" })]);
  assert.deepEqual(rs.map((r) => r.id), ["abc", "def"]);
});

// ── Lo que REALMENTE salió hacia BC ────────────────────────────────────────────
test("en el cotejo del envío el id es la POSICIÓN, no un id de la base", () => {
  // Estas líneas todavía no existen en SQL (la variante se resuelve en vuelo), así
  // que lo único estable para nombrarlas es el orden en que viajaron.
  const rs = lineasReplaceParaCotejo([
    { tipo: "articulo", itemNo: "A", cantidad: 1, precio: 10, unidad: "UND" },
    { tipo: "articulo", itemNo: "B", cantidad: 2, precio: 20, unidad: "UND" },
  ] as any);
  assert.deepEqual(rs.map((r) => r.id), ["0", "1"]);
});

test("el precio del envío pasa por el mismo normalizador que lo mandó a BC", () => {
  // Es `toBcAmount` (5 decimales, el máximo que BC guarda). Comparar el número crudo
  // contra lo normalizado haría que cada línea con decimales largos saliera como
  // "el precio no cuadra" sin que nadie haya cambiado nada.
  const [r] = lineasReplaceParaCotejo([
    { tipo: "articulo", itemNo: "A", cantidad: 1, precio: 1234.5678912, unidad: "UND" },
  ] as any);
  assert.equal(r.precioUnitario, 1234.56789);
});

test("y acepta el precio como texto en formato tico, igual que al mandarlo", () => {
  const [r] = lineasReplaceParaCotejo([
    { tipo: "articulo", itemNo: "A", cantidad: 1, precio: "1.234,56", unidad: "UND" },
  ] as any);
  assert.equal(r.precioUnitario, 1234.56);
});

test("el cargo del envío también se nombra por su chargeNo", () => {
  const [r] = lineasReplaceParaCotejo([
    { tipo: "cargo", chargeNo: "TRANSPORTE", itemNo: "", cantidad: 1, precio: 5000, unidad: "UND" },
  ] as any);
  assert.equal(r.itemNo, "TRANSPORTE");
});
