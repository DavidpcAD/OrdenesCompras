// Pruebas del borrador automático de la orden que se está armando.
// Lo que se protege acá es media hora de trabajo de Proveeduría: si `sanearBorrador`
// deja pasar basura, la pantalla arranca con una orden a medio armar de otra persona
// o con precios de la semana pasada; si es demasiado estricta, no rescata nada y el
// problema sigue igual.
//
//   npm test
import { test } from "node:test";
import assert from "node:assert/strict";
import { claveBorrador, sanearBorrador, hace, VIGENCIA_MS, type BorradorOrden } from "./borrador-orden.ts";

const AHORA = 1_756_000_000_000;
const bueno = (p: Partial<BorradorOrden<{ id: string }>> = {}): unknown => ({
  v: 1, ts: AHORA - 60_000, usuario: "Angie",
  proveedorId: "PROV-000670", currency: "", almacen: "ALM-GRAL",
  observaciones: "", notaInterna: "", metodoAsig: "Amount", cargos: [],
  filas: [{ id: "l1" }],
  ...p,
});

test("la clave separa por pantalla y por persona", () => {
  assert.equal(claveBorrador("nueva", "Angie"), "adelante_oc_borrador_nueva_angie");
  assert.notEqual(claveBorrador("nueva", "Angie"), claveBorrador("directa", "Angie"));
  assert.notEqual(claveBorrador("nueva", "Angie"), claveBorrador("nueva", "Fernando"));
});

test("un borrador propio y reciente se rescata entero", () => {
  const b = sanearBorrador<{ id: string }>(bueno(), "Angie", AHORA);
  assert.ok(b);
  assert.equal(b!.proveedorId, "PROV-000670");
  assert.equal(b!.filas.length, 1);
});

// En una computadora compartida (bodega, la de proveeduría) el siguiente que entra
// no puede encontrarse la orden a medio armar de otro.
test("el borrador de otra persona no se rescata", () => {
  assert.equal(sanearBorrador(bueno(), "Fernando", AHORA), null);
});

test("mayúsculas y espacios en el nombre no lo esconden", () => {
  assert.ok(sanearBorrador(bueno({ usuario: "  ANGIE " }), "angie", AHORA));
});

// Precios de hace más de una semana son de otra realidad: mejor no ofrecerlos.
test("un borrador vencido no se rescata", () => {
  assert.equal(sanearBorrador(bueno({ ts: AHORA - VIGENCIA_MS - 1 }), "Angie", AHORA), null);
  assert.ok(sanearBorrador(bueno({ ts: AHORA - VIGENCIA_MS + 1000 }), "Angie", AHORA));
});

test("formato viejo, vacío o corrupto se descarta sin romper", () => {
  assert.equal(sanearBorrador(bueno({ v: 0 }), "Angie", AHORA), null);
  assert.equal(sanearBorrador(bueno({ filas: [] }), "Angie", AHORA), null);
  assert.equal(sanearBorrador(bueno({ filas: undefined }), "Angie", AHORA), null);
  assert.equal(sanearBorrador(bueno({ ts: undefined }), "Angie", AHORA), null);
  assert.equal(sanearBorrador(null, "Angie", AHORA), null);
  assert.equal(sanearBorrador("{}", "Angie", AHORA), null);
  assert.equal(sanearBorrador({ hola: 1 }, "Angie", AHORA), null);
});

// Los campos de texto que falten no pueden llegar como undefined a un <input>
// controlado (React se queja y el campo deja de ser editable).
test("los campos que falten salen con un valor usable, no undefined", () => {
  const b = sanearBorrador<{ id: string }>(
    { v: 1, ts: AHORA, usuario: "Angie", filas: [{ id: "l1" }] }, "Angie", AHORA);
  assert.ok(b);
  assert.equal(b!.proveedorId, "");
  assert.equal(b!.observaciones, "");
  assert.equal(b!.metodoAsig, "Amount");   // el método de reparto tiene default real
  assert.deepEqual(b!.cargos, []);
});

test("hace(): dice de cuándo es el borrador en cristiano", () => {
  assert.equal(hace(AHORA - 20_000, AHORA), "recién");
  assert.equal(hace(AHORA - 5 * 60_000, AHORA), "hace 5 min");
  assert.equal(hace(AHORA - 3 * 3_600_000, AHORA), "hace 3 h");
  assert.equal(hace(AHORA - 24 * 3_600_000, AHORA), "de ayer");
  assert.equal(hace(AHORA - 3 * 24 * 3_600_000, AHORA), "hace 3 días");
});
