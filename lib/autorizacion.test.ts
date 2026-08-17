// La matriz rol→endpoint. Si esto se equivoca, o alguien hace algo que no le toca,
// o —peor— alguien deja de poder trabajar. Cada caso está escrito como la acción
// real de la persona. Corre con `npm test`.
import { test } from "node:test";
import assert from "node:assert/strict";
import { rolPuede, reglaPara, mensajeNoAutorizado, autorizacionActiva } from "./autorizacion.ts";

test("Angie arma y mueve órdenes y solicitudes; los otros no", () => {
  for (const [ruta, metodo] of [["/api/ordenes", "POST"], ["/api/ordenes/12", "PUT"], ["/api/ordenes/12", "PATCH"], ["/api/pedidos/7", "PATCH"], ["/api/pedidos/7", "DELETE"]] as const) {
    assert.equal(rolPuede(ruta, metodo, "proveeduria"), true, `${metodo} ${ruta} debería poder proveeduría`);
    assert.equal(rolPuede(ruta, metodo, "facturacion"), false, `${metodo} ${ruta} NO es de bodega`);
    assert.equal(rolPuede(ruta, metodo, "contabilidad"), false, `${metodo} ${ruta} NO es de contabilidad`);
  }
});

test("Bodega registra la recepción (y Contabilidad también: la pantalla tiene su variante)", () => {
  for (const ruta of ["/api/recepciones", "/api/bc/registrar", "/api/bc/recibir"]) {
    assert.equal(rolPuede(ruta, "POST", "facturacion"), true);
    assert.equal(rolPuede(ruta, "POST", "contabilidad"), true);
    assert.equal(rolPuede(ruta, "POST", "proveeduria"), false);
  }
});

test("marcar líneas para nota de crédito es de quien recibe, no de Angie", () => {
  assert.equal(rolPuede("/api/notas-credito", "POST", "facturacion"), true);
  assert.equal(rolPuede("/api/notas-credito", "POST", "contabilidad"), true);
  assert.equal(rolPuede("/api/notas-credito", "POST", "proveeduria"), false);
});

test("solo Kattya le pone el número a una factura en revisión (Modo 2)", () => {
  assert.equal(rolPuede("/api/recepciones/45", "PATCH", "contabilidad"), true);
  assert.equal(rolPuede("/api/recepciones/45", "PATCH", "facturacion"), false);
  assert.equal(rolPuede("/api/bc/facturar-recibido", "POST", "contabilidad"), true);
  assert.equal(rolPuede("/api/bc/facturar-recibido", "POST", "facturacion"), false);
});

test("acreditar una NC y el cargo sobre factura son solo de Contabilidad", () => {
  assert.equal(rolPuede("/api/notas-credito/3", "PATCH", "contabilidad"), true);
  assert.equal(rolPuede("/api/notas-credito/3", "PATCH", "facturacion"), false);
  assert.equal(rolPuede("/api/bc/cargo-recibido", "POST", "contabilidad"), true);
  assert.equal(rolPuede("/api/bc/cargo-recibido", "POST", "proveeduria"), false);
});

test("las LECTURAS quedan abiertas para los tres", () => {
  for (const rol of ["proveeduria", "facturacion", "contabilidad"] as const) {
    assert.equal(rolPuede("/api/bootstrap", "GET", rol), true);
    assert.equal(rolPuede("/api/ordenes", "GET", rol), true);           // ver órdenes: todos
    assert.equal(rolPuede("/api/movimientos", "GET", rol), true);
    assert.equal(rolPuede("/api/bc/vendors", "GET", rol), true);
  }
});

test("una ruta no listada no se bloquea (fail-open a propósito)", () => {
  assert.equal(reglaPara("/api/vistas", "POST"), null);
  assert.equal(rolPuede("/api/vistas", "POST", "facturacion"), true);
  assert.equal(rolPuede("/api/algo-nuevo", "POST", "facturacion"), true);
});

test("sin rol no se escribe nada de lo listado", () => {
  assert.equal(rolPuede("/api/ordenes", "POST", undefined), false);
  assert.equal(rolPuede("/api/recepciones", "POST", undefined), false);
});

test("el mensaje del 403 dice de quién es la acción", () => {
  const m = mensajeNoAutorizado("/api/notas-credito/3", "PATCH");
  assert.match(m, /Contabilidad/);
  assert.match(m, /acreditar/);
  assert.match(mensajeNoAutorizado("/api/ordenes", "POST"), /Proveeduría/);
});

test("el interruptor de emergencia: AUTORIZACION_ROLES=0 la desactiva", () => {
  const antes = process.env.AUTORIZACION_ROLES;
  try {
    delete process.env.AUTORIZACION_ROLES;
    assert.equal(autorizacionActiva(), true);      // por defecto, activa
    process.env.AUTORIZACION_ROLES = "1";
    assert.equal(autorizacionActiva(), true);
    process.env.AUTORIZACION_ROLES = "0";
    assert.equal(autorizacionActiva(), false);     // se apaga sin redeploy
  } finally {
    if (antes === undefined) delete process.env.AUTORIZACION_ROLES;
    else process.env.AUTORIZACION_ROLES = antes;
  }
});
