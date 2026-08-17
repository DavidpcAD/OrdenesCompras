// `toBcAmount` normaliza el precio que viaja a Business Central. Si se equivoca, el
// pedido queda en BC con otro monto — y eso nadie lo nota hasta que llega la factura.
// Corre con `npm test`.
import { test } from "node:test";
import assert from "node:assert/strict";
import { toBcAmount } from "./bc.ts";

test("números: se respetan y se redondean a 5 decimales", () => {
  assert.equal(toBcAmount(1234.56), 1234.56);
  assert.equal(toBcAmount(0), 0);
  assert.equal(toBcAmount(1.123456789), 1.12346);
  assert.equal(toBcAmount(-50), -50);
});

test("números inválidos caen a 0 (no se manda NaN a BC)", () => {
  assert.equal(toBcAmount(NaN), 0);
  assert.equal(toBcAmount(Infinity), 0);
  assert.equal(toBcAmount(undefined), 0);
  assert.equal(toBcAmount(null), 0);
  assert.equal(toBcAmount({}), 0);
  assert.equal(toBcAmount("abc"), 0);
  assert.equal(toBcAmount(""), 0);
});

test("strings simples", () => {
  assert.equal(toBcAmount("1234.56"), 1234.56);
  assert.equal(toBcAmount("1234,56"), 1234.56);   // coma decimal (es-CR)
  assert.equal(toBcAmount("  1234  "), 1234);
  assert.equal(toBcAmount("₡1234,56"), 1234.56);  // con símbolo de moneda
});

test("con separador de miles: el decimal es el que va ÚLTIMO", () => {
  assert.equal(toBcAmount("1.234,56"), 1234.56);      // es-CR
  assert.equal(toBcAmount("1,234.56"), 1234.56);      // en-US (antes daba 1.23456)
  assert.equal(toBcAmount("1.234.567,89"), 1234567.89);
  assert.equal(toBcAmount("1,234,567.89"), 1234567.89);
});
