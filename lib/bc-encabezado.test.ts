// El encabezado del pedido en BC (proveedor y moneda) tiene que decir lo que dice la
// orden. Antes solo se reescribían las líneas, y una orden que cambiaba de proveedor
// dejaba el pedido a nombre del otro (CP-005295, 4 sep 2026). Estas son las
// decisiones sin red: qué se manda y en qué orden.
//
//   npm test
import { test } from "node:test";
import assert from "node:assert/strict";
import { cambiosDeEncabezado, monedaBc } from "./bc.ts";

test("proveedor igual y moneda igual: nada que mandar", () => {
  assert.deepEqual(
    cambiosDeEncabezado({ vendorNo: "PROV-000101", currencyCode: "CRC" }, { vendorNo: "prov-000101", currencyCode: "" }),
    [],
  );
});

test("la orden cambió de proveedor: se manda el proveedor nuevo (CP-005295)", () => {
  const c = cambiosDeEncabezado({ vendorNo: "PROV-000522", currencyCode: "CRC" }, { vendorNo: "PROV-000101", currencyCode: "" });
  assert.equal(c.length, 1);
  assert.equal(c[0].campo, "proveedor");
  assert.deepEqual(c[0].body, { vendorNumber: "PROV-000101" });
  assert.match(c[0].texto, /PROV-000522/);
  assert.match(c[0].texto, /PROV-000101/);
});

test("la moneda local es \"\" en la app y \"CRC\" en BC, y son la misma", () => {
  assert.equal(monedaBc(""), "CRC");
  assert.equal(monedaBc(undefined), "CRC");
  assert.equal(monedaBc("crc"), "CRC");
  assert.equal(monedaBc("USD"), "USD");
  assert.deepEqual(cambiosDeEncabezado({ vendorNo: "P", currencyCode: "" }, { vendorNo: "P", currencyCode: "CRC" }), []);
});

test("cambian los dos: el proveedor va PRIMERO (BC le pone al pedido la moneda del proveedor nuevo)", () => {
  const c = cambiosDeEncabezado({ vendorNo: "PROV-000522", currencyCode: "CRC" }, { vendorNo: "PROV-000101", currencyCode: "USD" });
  assert.deepEqual(c.map((x) => x.campo), ["proveedor", "moneda"]);
  assert.deepEqual(c[1].body, { currencyCode: "USD" });
});

test("solo cambia la moneda: se manda solo la moneda", () => {
  const c = cambiosDeEncabezado({ vendorNo: "PROV-000101", currencyCode: "USD" }, { vendorNo: "PROV-000101", currencyCode: "" });
  assert.deepEqual(c.map((x) => x.campo), ["moneda"]);
  assert.deepEqual(c[0].body, { currencyCode: "CRC" });
});

test("sin proveedor en la orden no se manda un proveedor vacío", () => {
  assert.deepEqual(cambiosDeEncabezado({ vendorNo: "PROV-000522", currencyCode: "CRC" }, { vendorNo: "", currencyCode: "" }), []);
});
