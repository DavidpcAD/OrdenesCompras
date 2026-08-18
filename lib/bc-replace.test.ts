// Pruebas del payload que reescribe las líneas de un pedido en BC.
// Es la traducción app → BC de CANTIDAD y PRECIO: contra estos números Bodega
// recibe y Contabilidad factura. Si acá sale mal, entra mercadería equivocada al
// inventario y a la contabilidad, y en pantalla todo se ve bien.
//
//   npm test
import { test } from "node:test";
import assert from "node:assert/strict";
import { payloadReplaceLines, type LineaReplaceBc } from "./bc.ts";

const item = (p: Partial<LineaReplaceBc> = {}): LineaReplaceBc => ({
  tipo: "articulo", itemNo: "M01-0147", descripcion: "VARILLA DEFORME #3",
  cantidad: 6, precio: 1100, locationCode: "ALM-GRAL", ...p,
});

test("una línea de artículo viaja con el shape que espera el codeunit", () => {
  const { lines, omitidas } = payloadReplaceLines([item({
    variantCode: "AZUL", descuentoPct: 5, jobNo: "VB-5.01", taskNo: "1000",
  })]);
  assert.equal(omitidas.length, 0);
  assert.deepEqual(lines[0], {
    type: "Item", itemNo: "M01-0147", variantCode: "AZUL", locationCode: "ALM-GRAL",
    quantity: 6, directUnitCost: 1100, lineDiscountPct: 5, jobNo: "VB-5.01", taskNo: "1000",
  });
});

// El flete NO va como artículo: BC lo necesita como Item Charge o lo rechaza.
test("el cargo viaja como Charge con su tipo y método", () => {
  const { lines } = payloadReplaceLines([{
    tipo: "cargo", chargeNo: "FLETE", descripcion: "FLETE / TRANSPORTE",
    cantidad: 1, precio: 45000, chargeMethod: "Weight",
  }]);
  assert.deepEqual(lines[0], {
    type: "Charge", itemChargeNo: "FLETE", description: "FLETE / TRANSPORTE",
    quantity: 1, directUnitCost: 45000, chargeMethod: "Weight",
  });
});

test("un cargo sin método usa Amount, que es el reparto por defecto", () => {
  const { lines } = payloadReplaceLines([{ tipo: "cargo", chargeNo: "FLETE", cantidad: 1, precio: 100 }]);
  assert.equal((lines[0] as any).chargeMethod, "Amount");
  assert.equal((lines[0] as any).description, "FLETE");   // sin descripción, cae al código
});

// Un cargo sin tipo de Item Charge real hace que BC rechace la línea. Se omite y se
// REPORTA, en vez de inventar un código (el bug que ya se arregló al crear órdenes).
test("un cargo sin tipo se omite y se reporta con nombre", () => {
  const { lines, omitidas } = payloadReplaceLines([
    item(),
    { tipo: "cargo", descripcion: "FLETE SIN TIPO", cantidad: 1, precio: 100 },
  ]);
  assert.equal(lines.length, 1);
  assert.match(omitidas[0], /FLETE SIN TIPO/);
  assert.match(omitidas[0], /cargo sin tipo/);
});

test("una línea sin Nº de artículo se omite y se reporta", () => {
  const { lines, omitidas } = payloadReplaceLines([item({ itemNo: "", descripcion: "MATERIAL LIBRE" })]);
  assert.equal(lines.length, 0);
  assert.match(omitidas[0], /MATERIAL LIBRE/);
  assert.match(omitidas[0], /sin Nº de artículo/);
});

// Cantidad 0 o negativa no puede llegar a BC: el codeunit la omitiría igual, pero
// acá se captura para poder decirle al usuario QUÉ línea se cayó.
test("cantidad 0 o negativa se omite y se reporta", () => {
  const { lines, omitidas } = payloadReplaceLines([
    item({ cantidad: 0, descripcion: "CERO" }),
    item({ cantidad: -3, descripcion: "NEGATIVA" }),
    item({ descripcion: "BUENA" }),
  ]);
  assert.equal(lines.length, 1);
  assert.equal(omitidas.length, 2);
  assert.match(omitidas.join(" "), /CERO/);
  assert.match(omitidas.join(" "), /NEGATIVA/);
});

// El precio puede llegar como string desde el input. "1,234.56" (en-US) y
// "1.234,56" (es-CR) son el MISMO monto: si se lee mal, el costo va 1000× abajo
// (es el bug IT-722, que ya costó una corrección en producción).
test("normaliza el precio en cualquiera de los dos formatos", () => {
  assert.equal((payloadReplaceLines([item({ precio: "1,234.56" })]).lines[0] as any).directUnitCost, 1234.56);
  assert.equal((payloadReplaceLines([item({ precio: "1.234,56" })]).lines[0] as any).directUnitCost, 1234.56);
  assert.equal((payloadReplaceLines([item({ precio: "₡5 752,22" })]).lines[0] as any).directUnitCost, 5752.22);
});

// Un precio ilegible NO debe convertirse en 0 silencioso... pero tampoco reventar:
// queda en 0 y BC va a rechazar la línea con su propio error, que es visible.
test("un precio basura queda en 0 (BC lo rechaza y se ve el error)", () => {
  assert.equal((payloadReplaceLines([item({ precio: "abc" })]).lines[0] as any).directUnitCost, 0);
});

test("los campos opcionales viajan vacíos, no como undefined", () => {
  const { lines } = payloadReplaceLines([item({ variantCode: undefined, jobNo: undefined, taskNo: undefined, locationCode: undefined })]);
  const l = lines[0] as any;
  assert.equal(l.variantCode, "");
  assert.equal(l.jobNo, "");
  assert.equal(l.taskNo, "");
  assert.equal(l.locationCode, "");
  assert.equal(l.lineDiscountPct, 0);
});

test("sin líneas devuelve vacío sin reventar", () => {
  assert.deepEqual(payloadReplaceLines([]), { lines: [], omitidas: [] });
});
