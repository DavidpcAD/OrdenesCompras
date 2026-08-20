// El bootstrap es el latido de la app: la carga inicial y el refresco cada 45 s
// pasan por acá. Estas pruebas fijan tres cosas que, si se rompen, se rompen en
// silencio (nadie ve un error; simplemente la pantalla deja de estar al día):
//   1. el ETag se manda de vuelta, así el servidor puede contestar 304;
//   2. un 304 se traduce a `null` (= "nada cambió"), no a datos vacíos;
//   3. dos refrescos simultáneos son UN solo viaje al servidor.
import { test } from "node:test";
import assert from "node:assert/strict";

// Reset de módulo por prueba: el ETag vive en un `let` del módulo.
async function cargarApi() {
  return (await import(`./api.ts?t=${Math.random()}`)).api;
}

type Llamada = { url: string; ifNoneMatch: string | null };

function fetchFalso(respuestas: Array<{ status: number; etag?: string; body?: unknown }>) {
  const llamadas: Llamada[] = [];
  let i = 0;
  globalThis.fetch = (async (input: any, init?: any) => {
    const h = new Headers(init?.headers ?? {});
    llamadas.push({ url: String(input), ifNoneMatch: h.get("If-None-Match") });
    const r = respuestas[Math.min(i++, respuestas.length - 1)];
    const headers = new Headers();
    if (r.etag) headers.set("ETag", r.etag);
    return new Response(r.status === 304 ? null : JSON.stringify(r.body ?? {}), { status: r.status, headers });
  }) as any;
  return llamadas;
}

const DATOS = { pedidos: [{ id: "1" }], ordenes: [], recepciones: [], notas: [] };

test("la primera carga no manda If-None-Match y devuelve los datos", async () => {
  const api = await cargarApi();
  const llamadas = fetchFalso([{ status: 200, etag: 'W/"abc"', body: DATOS }]);
  const b = await api.bootstrap();
  assert.equal(llamadas.length, 1);
  assert.equal(llamadas[0].ifNoneMatch, null);
  assert.deepEqual(b, DATOS);
});

test("la segunda carga manda el ETag recibido y un 304 se traduce a null", async () => {
  const api = await cargarApi();
  const llamadas = fetchFalso([
    { status: 200, etag: 'W/"abc"', body: DATOS },
    { status: 304, etag: 'W/"abc"' },
  ]);
  await api.bootstrap();
  const segunda = await api.bootstrap();
  assert.equal(llamadas[1].ifNoneMatch, 'W/"abc"');
  // null = "nada cambió". Si esto devolviera {} o listas vacías, la app se
  // "vaciaría" sola cada 45 s aunque en la base estuviera todo.
  assert.equal(segunda, null);
});

test("cuando cambia el ETag, entran los datos nuevos y se guarda el ETag nuevo", async () => {
  const api = await cargarApi();
  const DATOS2 = { pedidos: [{ id: "1" }, { id: "2" }], ordenes: [], recepciones: [], notas: [] };
  const llamadas = fetchFalso([
    { status: 200, etag: 'W/"v1"', body: DATOS },
    { status: 200, etag: 'W/"v2"', body: DATOS2 },
    { status: 304, etag: 'W/"v2"' },
  ]);
  await api.bootstrap();
  assert.deepEqual(await api.bootstrap(), DATOS2);
  await api.bootstrap();
  assert.equal(llamadas[2].ifNoneMatch, 'W/"v2"');
});

test("un error NO deja guardado el ETag (si no, se creería al día sin estarlo)", async () => {
  const api = await cargarApi();
  const llamadas = fetchFalso([
    { status: 500, etag: 'W/"nodeberia"', body: { error: "base caída" } },
    { status: 200, etag: 'W/"ok"', body: DATOS },
  ]);
  await assert.rejects(() => api.bootstrap(), /base caída/);
  await api.bootstrap();
  assert.equal(llamadas[1].ifNoneMatch, null);
});

test("dos refrescos a la vez son un solo viaje al servidor", async () => {
  const api = await cargarApi();
  const llamadas = fetchFalso([{ status: 200, etag: 'W/"abc"', body: DATOS }]);
  const [a, b] = await Promise.all([api.bootstrap(), api.bootstrap()]);
  assert.equal(llamadas.length, 1);
  assert.deepEqual(a, DATOS);
  assert.deepEqual(b, DATOS);
});
