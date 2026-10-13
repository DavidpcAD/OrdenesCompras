// EL TOPE DE ESPERA DE CADA LLAMADA A BC.
//
// `bcFetch` no tenía tope: una sola llamada colgada del lado de BC (un lock, un pico
// de concurrencia) dejaba la petición esperando el timeout de undici (~300 s), y como
// "Enviar a aprobación" encadena ~12-18 de estas en serie, el botón se quedaba en
// "Enviando…" por minutos SIN avisarle a nadie —aunque el pedido ya estuviera creado
// en BC—. El tope lo corta en <1 min. Lo que estas pruebas cuidan es el default seguro
// y que la variable de Azure se lea bien: un typo no puede dejar el tope en cero (sin
// espera) ni mandarlo a undefined (sin tope, que es el bug que esto arregla).
import { test } from "node:test";
import assert from "node:assert/strict";
import { bcFetchTimeoutMs } from "./bc.ts";

const con = (valor: string | undefined, fn: () => number) => {
  const previo = process.env.BC_FETCH_TIMEOUT_MS;
  if (valor === undefined) delete process.env.BC_FETCH_TIMEOUT_MS;
  else process.env.BC_FETCH_TIMEOUT_MS = valor;
  try { return fn(); } finally {
    if (previo === undefined) delete process.env.BC_FETCH_TIMEOUT_MS;
    else process.env.BC_FETCH_TIMEOUT_MS = previo;
  }
};

test("sin la variable puesta, el tope es 60 s", () => {
  assert.equal(con(undefined, bcFetchTimeoutMs), 60_000);
});

test("la variable de Azure lo cambia (p.ej. aflojar a 90 s)", () => {
  assert.equal(con("90000", bcFetchTimeoutMs), 90_000);
});

test("un valor basura NO deja la app sin tope: cae al default", () => {
  // El bug que esto arregla es justamente 'sin tope'. Un typo tiene que degradar al
  // default seguro, nunca a NaN/undefined (que volvería a colgar como antes).
  for (const basura of ["", "   ", "abc", "NaN"]) {
    assert.equal(con(basura, bcFetchTimeoutMs), 60_000, `con "${basura}"`);
  }
});

test("cero o negativo NO valen (sería 'ríndete de una'): cae al default", () => {
  assert.equal(con("0", bcFetchTimeoutMs), 60_000);
  assert.equal(con("-5000", bcFetchTimeoutMs), 60_000);
});
