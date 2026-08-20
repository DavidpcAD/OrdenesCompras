// El guard envuelve TODAS las llamadas a /api/* del navegador. Es el punto donde
// se decide qué pasa cuando la red falla o la sesión venció, así que su contrato
// tiene que estar clavado: un reintento de más en un POST duplicaría una orden de
// compra, y un 401 sin redirigir es exactamente la pantalla que hay que eliminar
// (app "logueada" con el aviso rojo encima).
import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";

// Ventana falsa: el guard envuelve `window.fetch` y usa location/eventos.
type Estado = { llamadas: Array<{ url: string; cache?: string }>; redirigido: string | null; eventos: string[] };
let estado: Estado;

function montarVentana(pathname: string, respuestas: Array<{ status?: number; error?: boolean }>) {
  estado = { llamadas: [], redirigido: null, eventos: [] };
  let i = 0;
  const fetchBase = async (input: any, init?: any) => {
    estado.llamadas.push({ url: String(input), cache: init?.cache });
    const r = respuestas[Math.min(i++, respuestas.length - 1)];
    if (r.error) throw new TypeError("Failed to fetch");
    return new Response("{}", { status: r.status ?? 200 });
  };
  (globalThis as any).window = {
    fetch: fetchBase,
    location: {
      origin: "https://proveeduria.adelante.cr",
      pathname,
      search: "",
      replace: (u: string) => { estado.redirigido = u; },
    },
    dispatchEvent: (e: Event) => { estado.eventos.push(e.type); return true; },
  };
  (globalThis as any).localStorage = { removeItem: () => {} };
}

// El guard se instala UNA vez por proceso (`instalado`), así que se importa fresco
// en cada prueba para poder envolver la ventana nueva.
async function instalar() {
  const m = await import(`./fetch-guard.ts?t=${Math.random()}`);
  m.instalarGuardFetch();
  return (globalThis as any).window.fetch;
}

beforeEach(() => { estado = { llamadas: [], redirigido: null, eventos: [] }; });

test("un 503 se reintenta una vez y la segunda respuesta es la que vale", async () => {
  montarVentana("/proveeduria/ordenes", [{ status: 503 }, { status: 200 }]);
  const fetch = await instalar();
  const res = await fetch("/api/bootstrap");
  assert.equal(res.status, 200);
  assert.equal(estado.llamadas.length, 2);
});

test("un error de red se reintenta; si el segundo también falla, se propaga", async () => {
  montarVentana("/proveeduria/ordenes", [{ error: true }]);
  const fetch = await instalar();
  await assert.rejects(() => fetch("/api/bootstrap"), /Failed to fetch/);
  assert.equal(estado.llamadas.length, 2);
});

test("un 500 NO se reintenta (repetir una consulta mala solo duplica la espera)", async () => {
  montarVentana("/proveeduria/ordenes", [{ status: 500 }]);
  const fetch = await instalar();
  const res = await fetch("/api/bootstrap");
  assert.equal(res.status, 500);
  assert.equal(estado.llamadas.length, 1);
});

test("un POST que falla NO se reintenta (reintentar crearía la orden dos veces)", async () => {
  montarVentana("/proveeduria/nueva", [{ status: 503 }]);
  const fetch = await instalar();
  const res = await fetch("/api/ordenes", { method: "POST", body: "{}" });
  assert.equal(res.status, 503);
  assert.equal(estado.llamadas.length, 1);
});

test("un 401 manda al login guardando a dónde volver", async () => {
  montarVentana("/facturacion/recibidas", [{ status: 401 }]);
  const fetch = await instalar();
  await fetch("/api/bootstrap");
  assert.equal(estado.redirigido, "/?motivo=sesion&next=%2Ffacturacion%2Frecibidas");
  assert.ok(estado.eventos.includes("adelante:sesion-vencida"));
});

test("un 401 del login NO es sesión vencida (es usuario o clave mala)", async () => {
  montarVentana("/", [{ status: 401 }]);
  const fetch = await instalar();
  await fetch("/api/login", { method: "POST", body: "{}" });
  assert.equal(estado.redirigido, null);
  assert.equal(estado.eventos.length, 0);
});

test("estando ya en el login, un 401 no toca la URL (no borra el ?next=)", async () => {
  montarVentana("/", [{ status: 401 }]);
  const fetch = await instalar();
  await fetch("/api/bootstrap");
  assert.equal(estado.redirigido, null);
});

test("a las llamadas de /api se les fuerza no-store (nada de datos cacheados)", async () => {
  montarVentana("/proveeduria/ordenes", [{ status: 200 }]);
  const fetch = await instalar();
  await fetch("/api/bootstrap");
  assert.equal(estado.llamadas[0].cache, "no-store");
});

test("lo que no es /api pasa intacto (RSC de Next, fuentes, BC directo)", async () => {
  montarVentana("/proveeduria/ordenes", [{ status: 200 }]);
  const fetch = await instalar();
  await fetch("https://fonts.googleapis.com/css2?family=Roboto");
  assert.equal(estado.llamadas[0].cache, undefined);
});
