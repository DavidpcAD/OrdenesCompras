import { test } from "node:test";
import assert from "node:assert/strict";
import { faltaParaRegistrar, unirConY, type DatosParaRegistrar } from "./falta-para-registrar.ts";

const listo: DatosParaRegistrar = {
  algoRecibido: true, numeroFactura: "F-0099281", tarjetaOn: false, tarjeta: "", dimCode: "", dimValue: "",
};

test("con todo puesto no falta nada", () => {
  assert.deepEqual(faltaParaRegistrar(listo), []);
});

test("sin N.º de factura lo dice (el caso de Bodega: botón gris y nada más)", () => {
  assert.deepEqual(faltaParaRegistrar({ ...listo, numeroFactura: "" }), ["el N.º de factura del proveedor"]);
  // Solo espacios es vacío: el botón ya lo trataba así (trim).
  assert.deepEqual(faltaParaRegistrar({ ...listo, numeroFactura: "   " }), ["el N.º de factura del proveedor"]);
});

test("sin cantidad recibida lo dice", () => {
  assert.deepEqual(faltaParaRegistrar({ ...listo, algoRecibido: false }), ["la cantidad que llegó en al menos una línea"]);
});

test("la tarjeta solo cuenta si está marcada", () => {
  assert.deepEqual(faltaParaRegistrar({ ...listo, tarjetaOn: false, tarjeta: "" }), []);
  assert.deepEqual(faltaParaRegistrar({ ...listo, tarjetaOn: true }), ["la tarjeta", "la dimensión", "el valor de la dimensión"]);
  assert.deepEqual(faltaParaRegistrar({ ...listo, tarjetaOn: true, tarjeta: "TC", dimCode: "TM" }), ["el valor de la dimensión"]);
});

test("varias cosas a la vez, en el orden de la pantalla", () => {
  assert.deepEqual(faltaParaRegistrar({ ...listo, numeroFactura: "", algoRecibido: false }),
    ["el N.º de factura del proveedor", "la cantidad que llegó en al menos una línea"]);
});

test("unir con y", () => {
  assert.equal(unirConY([]), "");
  assert.equal(unirConY(["a"]), "a");
  assert.equal(unirConY(["a", "b"]), "a y b");
  assert.equal(unirConY(["a", "b", "c"]), "a, b y c");
});
