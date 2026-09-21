// Pruebas de la caché de la última carga. Lo que se protege acá no es la velocidad:
// es que una caché rara NUNCA pinte datos de otra persona, de otro día o de otra
// versión del payload.
//
//   npm test
import { test } from "node:test";
import assert from "node:assert/strict";
import { VIDA_CACHE_MS, leerCache, serializarCache } from "./cache-bootstrap.ts";

const AHORA = Date.parse("2026-09-21T15:00:00-06:00");
const BODY = '{"pedidos":[],"ordenes":[{"id":"1"}],"recepciones":[],"notas":[]}';

test("lo guardado hace un rato por el mismo usuario se usa", () => {
  const raw = serializarCache("angie", 'W/"abc"', BODY, AHORA - 60_000);
  assert.deepEqual(leerCache(raw, "angie", AHORA), { etag: 'W/"abc"', body: BODY, t: AHORA - 60_000 });
});

test("lo de otra persona no se pinta", () => {
  const raw = serializarCache("angie", 'W/"abc"', BODY, AHORA - 60_000);
  assert.equal(leerCache(raw, "pedro", AHORA), null);
  assert.equal(leerCache(raw, "", AHORA), null);
});

test("lo de ayer no se pinta", () => {
  assert.equal(leerCache(serializarCache("angie", null, BODY, AHORA - VIDA_CACHE_MS), "angie", AHORA), null);
  assert.deepEqual(leerCache(serializarCache("angie", null, BODY, AHORA - VIDA_CACHE_MS + 1000), "angie", AHORA), { etag: null, body: BODY, t: AHORA - VIDA_CACHE_MS + 1000 });
});

test("con el reloj movido hacia atrás se descarta", () => {
  assert.equal(leerCache(serializarCache("angie", null, BODY, AHORA + 60_000), "angie", AHORA), null);
});

test("una caché de otra versión del payload se ignora", () => {
  const raw = JSON.stringify({ v: 0, usuario: "angie", etag: null, t: AHORA, body: BODY });
  assert.equal(leerCache(raw, "angie", AHORA), null);
});

test("la basura no tumba la carga: se arranca como siempre", () => {
  for (const raw of [null, "", "no es json", "null", "123", "{}", '{"v":1,"usuario":"angie"}',
    JSON.stringify({ v: 1, usuario: "angie", t: AHORA, body: "" }),
    JSON.stringify({ v: 1, usuario: "angie", t: "ayer", body: BODY })]) {
    assert.equal(leerCache(raw, "angie", AHORA), null, `con ${JSON.stringify(raw)}`);
  }
});

test("sin ETag guardado igual se usa el cuerpo (se pedirá completo)", () => {
  const raw = JSON.stringify({ v: 1, usuario: "angie", etag: 42, t: AHORA, body: BODY });
  assert.deepEqual(leerCache(raw, "angie", AHORA), { etag: null, body: BODY, t: AHORA });
});
