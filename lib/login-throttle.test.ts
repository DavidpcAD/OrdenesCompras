// El freno del login: demora creciente por usuario, sin bloquear cuentas.
// Se prueba con el reloj simulado del runner de Node para poder saltar la ventana
// de 15 minutos sin esperarla. Corre con `npm test`.
import { test, mock } from "node:test";
import assert from "node:assert/strict";
import { demoraPorFallos, registrarFallo, registrarExito } from "./login-throttle.ts";

test("la demora crece con cada fallo y tiene tope", () => {
  const u = "usuario-demora";
  assert.equal(demoraPorFallos(u), 0);          // primer intento: sin castigo
  registrarFallo(u);
  assert.equal(demoraPorFallos(u), 250);
  registrarFallo(u);
  assert.equal(demoraPorFallos(u), 500);
  for (let i = 0; i < 50; i++) registrarFallo(u);
  assert.equal(demoraPorFallos(u), 2000);       // tope, no crece para siempre
});

test("no distingue mayúsculas ni espacios", () => {
  registrarFallo("  Kattya ");
  assert.equal(demoraPorFallos("kattya"), 250);
});

test("un usuario no arrastra al otro (no se bloquea a nadie de rebote)", () => {
  registrarFallo("uno");
  registrarFallo("uno");
  assert.equal(demoraPorFallos("otro"), 0);
});

test("entrar bien limpia el contador", () => {
  const u = "usuario-exito";
  registrarFallo(u);
  registrarFallo(u);
  assert.ok(demoraPorFallos(u) > 0);
  registrarExito(u);
  assert.equal(demoraPorFallos(u), 0);
});

test("los fallos se olvidan pasada la ventana de 15 minutos", () => {
  mock.timers.enable({ apis: ["Date"], now: new Date("2026-08-17T09:00:00Z") });
  try {
    const u = "usuario-ventana";
    registrarFallo(u);
    assert.equal(demoraPorFallos(u), 250);
    mock.timers.setTime(new Date("2026-08-17T09:16:00Z").getTime());   // +16 min
    assert.equal(demoraPorFallos(u), 0);
  } finally {
    mock.timers.reset();
  }
});
