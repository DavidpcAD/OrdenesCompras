// "La factura ya existe" en BC NO prueba que ESTA recepción esté registrada: el
// número lo pudo haber usado otro pedido, o una factura que después se anuló. Caso
// real del 10 nov 2026: CP-006578 (DITESA) quedó "Completa" en la app enlazada a
// CFR-012069, que era de CP-006485 y estaba anulada con la nota de crédito
// CNCR-000507. En BC el pedido siguió sin recibir.
//
//   npm test
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  duenoDeLaFactura, esFacturaAjena, explicarFacturaYaUsada, facturaNoSirve, numerosDeFactura,
  pruebaQueYaEntro, queHacerConFacturaYaUsada, tituloFacturaYaUsada,
} from "./factura-ajena.ts";

test("duenoDeLaFactura: la factura de otro pedido no es de esta orden (CP-006578 / CFR-012069)", () => {
  assert.equal(duenoDeLaFactura("CP-006485", "CP-006578"), "otra-orden");
  assert.equal(esFacturaAjena("otra-orden"), true);
});

test("duenoDeLaFactura: la del mismo pedido sí es (el posteo entró y la app no se enteró, CP-005148)", () => {
  assert.equal(duenoDeLaFactura("CP-005148", "CP-005148"), "esta-orden");
  // BC y la app no siempre escriben igual: espacios y mayúsculas no cambian el pedido.
  assert.equal(duenoDeLaFactura(" cp-005148 ", "CP-005148"), "esta-orden");
  assert.equal(esFacturaAjena("esta-orden"), false);
});

test("duenoDeLaFactura: registrada sin pedido tampoco prueba que esta orden entró", () => {
  assert.equal(duenoDeLaFactura("", "CP-006578"), "sin-pedido");
  assert.equal(esFacturaAjena("sin-pedido"), true);
});

test("duenoDeLaFactura: sin dato no se supone nada, ni para un lado ni para el otro", () => {
  assert.equal(duenoDeLaFactura(null, "CP-006578"), "sin-dato");
  assert.equal(duenoDeLaFactura(undefined, "CP-006578"), "sin-dato");
  // Una orden sin pedido en BC no se puede comparar con nada.
  assert.equal(duenoDeLaFactura("CP-006485", ""), "sin-dato");
  assert.equal(esFacturaAjena("sin-dato"), false);
});

test("pruebaQueYaEntro: solo la factura viva de este mismo pedido", () => {
  assert.equal(pruebaQueYaEntro("esta-orden"), true);
  assert.equal(pruebaQueYaEntro("esta-orden", ""), true);
  // Anulada no prueba nada, aunque sea de este pedido.
  assert.equal(pruebaQueYaEntro("esta-orden", "CNCR-000507"), false);
  assert.equal(pruebaQueYaEntro("otra-orden"), false);
  assert.equal(pruebaQueYaEntro("sin-pedido"), false);
  assert.equal(pruebaQueYaEntro("sin-dato"), false);
});

test("facturaNoSirve: de otro pedido, sin pedido o anulada; sin dato no se afirma", () => {
  assert.equal(facturaNoSirve("otra-orden"), true);
  assert.equal(facturaNoSirve("sin-pedido"), true);
  assert.equal(facturaNoSirve("esta-orden", "CNCR-000507"), true);
  assert.equal(facturaNoSirve("sin-dato", "CNCR-000507"), true);
  assert.equal(facturaNoSirve("esta-orden"), false);
  assert.equal(facturaNoSirve("sin-dato"), false);
});

test("numerosDeFactura: uno o varios CFR, como los guarda la conciliación", () => {
  assert.deepEqual(numerosDeFactura("CFR-012069"), ["CFR-012069"]);
  assert.deepEqual(numerosDeFactura("CFR-010199, CFR-010200"), ["CFR-010199", "CFR-010200"]);
  assert.deepEqual(numerosDeFactura("  "), []);
  assert.deepEqual(numerosDeFactura(undefined), []);
});

const casoDitesa = {
  facturaProveedor: "137564", factura: "CFR-012069", pedidoDeLaFactura: "CP-006485",
  anuladaCon: "CNCR-000507", orderNo: "CP-006578",
};

test("explicarFacturaYaUsada: dice qué factura, de qué pedido, con qué nota se anuló y que esta NO entró", () => {
  const t = explicarFacturaYaUsada(casoDitesa);
  assert.match(t, /137564/);
  assert.match(t, /CFR-012069/);
  assert.match(t, /del pedido CP-006485/);
  assert.match(t, /nota de crédito CNCR-000507/);
  assert.match(t, /NO quedó registrada/);
  assert.equal(tituloFacturaYaUsada(casoDitesa), "La factura 137564 ya se usó en otro pedido");
});

test("explicarFacturaYaUsada: la anulada de este mismo pedido no dice 'otro pedido'", () => {
  const mismo = { ...casoDitesa, orderNo: "CP-006485" };
  assert.match(explicarFacturaYaUsada(mismo), /de este mismo pedido/);
  assert.equal(tituloFacturaYaUsada(mismo), "La factura 137564 ya se usó en BC y está anulada");
});

test("explicarFacturaYaUsada: sin pedido y sin nota de crédito", () => {
  const t = explicarFacturaYaUsada({ facturaProveedor: "137564", factura: "CFR-012069", pedidoDeLaFactura: "", orderNo: "CP-006578" });
  assert.match(t, /sin pedido/);
  assert.doesNotMatch(t, /nota de crédito/);
});

test("queHacerConFacturaYaUsada: pide otro N.º con un ejemplo concreto", () => {
  assert.match(queHacerConFacturaYaUsada({ facturaProveedor: "137564" }), /137564-1/);
  assert.doesNotMatch(queHacerConFacturaYaUsada({ facturaProveedor: "" }), /por ejemplo/);
});
