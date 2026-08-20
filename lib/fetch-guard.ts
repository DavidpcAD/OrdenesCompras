"use client";

// Guard único para TODAS las llamadas a /api/* del navegador.
//
// Por qué existe: en la app hay ~30 `fetch("/api/…")` sueltos (proveedores, items,
// almacenes, existencias, variantes, vistas, movimientos…) y casi todos terminan en
// `.catch(() => {})`. Cuando la sesión vencía o el celular perdía la red un segundo,
// esos fetch fallaban CALLADOS: el combo de proveedores salía vacío, las existencias
// no aparecían, y no había forma de saber que el problema era la conexión y no que
// "no hay datos". Y si el que fallaba era el bootstrap, la pantalla se quedaba con el
// aviso rojo encima de datos viejos.
//
// En vez de tocar 30 sitios, se envuelve `window.fetch` UNA vez y solo para las URLs
// propias (/api/…). Todo lo demás (RSC de Next, fuentes, BC directo) pasa intacto.
//
// Qué agrega:
//   1. Timeout de verdad (un fetch sin timeout se queda colgado para siempre).
//   2. Un reintento automático en fallos transitorios (red móvil, 502/503/504,
//      Azure SQL serverless despertando) — solo en GET, que es seguro repetir.
//   3. Manejo CENTRAL del 401: sesión vencida → aviso + vuelta al login guardando
//      a dónde volver. Nunca más la app "logueada" mostrando datos que no cargan.

export const EVENTO_SESION_VENCIDA = "adelante:sesion-vencida";

// Cuánto se espera antes de cortar. Generoso a propósito: la base de Azure es
// serverless y el primer request después de un rato la tiene que "despertar"
// (lib/db.ts ya usa 60 s de connectionTimeout). Cortar antes convertiría un
// arranque lento en un error.
const TIMEOUT_MS = 45_000;
const TIMEOUT_BC_MS = 60_000; // Business Central es más lento que SQL

let instalado = false;
let redirigiendo = false;

function rutaApi(input: RequestInfo | URL): string | null {
  try {
    const crudo =
      typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    const u = new URL(crudo, window.location.origin);
    if (u.origin !== window.location.origin) return null;
    return u.pathname.startsWith("/api/") ? u.pathname : null;
  } catch {
    return null;
  }
}

// Señal que aborta por timeout, respetando la que venga del que llama (si el
// componente se desmonta y aborta, se aborta de una; no se espera el timeout).
function señalConTimeout(ms: number, externa?: AbortSignal | null) {
  const ctrl = new AbortController();
  const id = setTimeout(() => ctrl.abort(new DOMException("Timeout", "TimeoutError")), ms);
  if (externa) {
    if (externa.aborted) ctrl.abort(externa.reason);
    else externa.addEventListener("abort", () => ctrl.abort(externa.reason), { once: true });
  }
  return { signal: ctrl.signal, cancelar: () => clearTimeout(id) };
}

// ¿Vale la pena reintentar? Solo lo idempotente (GET/HEAD) y solo por causas
// transitorias. Un 500 NO se reintenta: si la consulta está mal, repetirla solo
// duplica el trabajo del servidor y duplica la espera del usuario.
function esReintentable(metodo: string, res: Response | null): boolean {
  if (metodo !== "GET" && metodo !== "HEAD") return false;
  if (!res) return true; // error de red / timeout
  return res.status === 502 || res.status === 503 || res.status === 504;
}

const esperar = (ms: number) => new Promise((r) => setTimeout(r, ms));

// Sesión vencida: se limpia el rastro local y se vuelve al login diciendo por qué
// y a dónde volver. Una sola vez (si vencen 5 llamadas juntas, no son 5 redirects).
export function sesionVencida() {
  if (redirigiendo) return;
  redirigiendo = true;
  try {
    localStorage.removeItem("adelante_oc_role");
    localStorage.removeItem("adelante_oc_usuario");
  } catch {}
  window.dispatchEvent(new Event(EVENTO_SESION_VENCIDA));
  // Ya estamos en el login: no hay a dónde mandar a nadie. Y sobre todo NO se toca
  // la URL: si el middleware nos trajo con ?next=…, navegar acá borraría justamente
  // la pantalla a la que hay que volver después de entrar.
  if (window.location.pathname === "/") { redirigiendo = false; return; }
  const volverA = window.location.pathname + window.location.search;
  // replace (no href): la pantalla vencida no queda en el historial, así el botón
  // "atrás" no devuelve a una pantalla que ya no carga.
  window.location.replace(`/?motivo=sesion&next=${encodeURIComponent(volverA)}`);
}

export function instalarGuardFetch() {
  if (instalado || typeof window === "undefined") return;
  instalado = true;
  const original = window.fetch.bind(window);

  window.fetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const ruta = rutaApi(input);
    if (!ruta) return original(input, init);

    const metodo = (init?.method ?? (input instanceof Request ? input.method : "GET")).toUpperCase();
    const ms = ruta.startsWith("/api/bc/") ? TIMEOUT_BC_MS : TIMEOUT_MS;

    const pedir = async (): Promise<Response> => {
      const { signal, cancelar } = señalConTimeout(ms, init?.signal ?? null);
      try {
        // no-store: estos datos son operativos (¿ya me llegó la orden?). Un
        // intermedio guardándolos en caché es justo lo contrario de "al día".
        return await original(input, { cache: "no-store", ...init, signal });
      } finally {
        cancelar();
      }
    };

    let res: Response | null = null;
    let error: unknown = null;
    try {
      res = await pedir();
    } catch (e) {
      // Aborto pedido por el que llama: se respeta, no se reintenta.
      if (init?.signal?.aborted) throw e;
      error = e;
    }

    if (esReintentable(metodo, res)) {
      await esperar(700);
      try {
        res = await pedir();
        error = null;
      } catch (e) {
        if (init?.signal?.aborted) throw e;
        error = e;
      }
    }

    if (!res) throw error instanceof Error ? error : new Error(String(error));

    // 401 = la cookie de sesión ya no vale. Único lugar donde se decide qué hacer.
    // /api/login se excluye: ahí un 401 significa "usuario o clave mala".
    if (res.status === 401 && ruta !== "/api/login") sesionVencida();
    return res;
  };
}
