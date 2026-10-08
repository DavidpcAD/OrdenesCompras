// EL BOOTSTRAP NO SE RECALCULA UNA VEZ POR PESTAÑA.
//
// `/api/bootstrap` corre tres consultas que traen toda la historia (solicitudes,
// órdenes y recepciones con sus líneas), más las unidades de compra de Business
// Central. Eso costaba ~2 s de base CADA vez, y cada pantalla abierta lo pide cada
// 45 s: medido el 5 oct 2026, 793 cargas en 5 horas contra una base que tiene un
// techo de vCores. Dos pestañas que caen juntas lo corrían DOS veces completo.
//
// Acá hay dos cosas, y la primera es la que importa:
//
//  1. Una sola corrida a la vez (coalescing). Quien llega mientras otra va en vuelo
//     espera ESA, no arranca otra. No puede dar datos más viejos que la corrida que
//     ya estaba andando, así que no tiene contra.
//  2. Una ventana corta de reúso (TTL). Lo que se sirve puede tener hasta N segundos,
//     con N configurable y chiquito. La pantalla ya muestra datos de hasta 45 s
//     (ese es el refresco), así que esto no cambia lo que la gente ve.
//
// Y toda ESCRITURA lo invalida (ver `invalidarBootstrap` en lib/repo.ts): quien
// acaba de guardar algo no puede toparse con una foto vieja que no lo incluye.
// El TTL es la red por si alguna escritura se olvidara de avisar: a lo sumo se
// arregla sola en N segundos.

export type FuenteBootstrap = "fresco" | "en-vuelo" | "cache";

export interface CacheBootstrap<T> {
  obtener(calcular: () => Promise<T>): Promise<{ valor: T; fuente: FuenteBootstrap; edadMs: number }>;
  invalidar(): void;
}

export function crearCacheBootstrap<T>(ttlMs: number, ahora: () => number = Date.now): CacheBootstrap<T> {
  let enVuelo: Promise<T> | null = null;
  let ultimo: { valor: T; ts: number } | null = null;

  return {
    async obtener(calcular) {
      if (ultimo && ttlMs > 0) {
        const edadMs = ahora() - ultimo.ts;
        if (edadMs < ttlMs) return { valor: ultimo.valor, fuente: "cache", edadMs };
      }
      // Ya hay una corrida en vuelo: colgarse de esa en vez de abrir otra.
      if (enVuelo) return { valor: await enVuelo, fuente: "en-vuelo", edadMs: 0 };

      const p = calcular();
      enVuelo = p;
      try {
        const valor = await p;
        // Si alguien invalidó MIENTRAS esto corría, lo calculado ya nació viejo y no
        // se guarda: la próxima lo vuelve a pedir. (`enVuelo` se limpia igual.)
        if (enVuelo === p) ultimo = { valor, ts: ahora() };
        return { valor, fuente: "fresco", edadMs: 0 };
      } finally {
        // Un fallo NO se cachea y no deja la cache trabada: el siguiente reintenta.
        if (enVuelo === p) enVuelo = null;
      }
    },
    invalidar() {
      ultimo = null;
      // Lo que esté a medio calcular arrancó antes de la escritura, así que tampoco
      // sirve para guardar: marcarlo como huérfano para que no se cachee.
      enVuelo = null;
    },
  };
}

// Lo que se guarda es la RESPUESTA ya armada (cuerpo + ETag): en un reúso no se
// vuelve a serializar 2,1 MB ni a calcular su huella, que es la otra mitad del costo.
export interface FotoBootstrap {
  body: string;
  etag: string;
  resumen: string;   // la línea que va al log, ya escrita
}

// Una sola por proceso, creada en el primer uso: así `BOOTSTRAP_CACHE_SEGUNDOS` se
// lee del entorno de Azure en tiempo de ejecución y no queda horneada en el build.
let unica: CacheBootstrap<FotoBootstrap> | null = null;

export function cacheBootstrap(): CacheBootstrap<FotoBootstrap> {
  if (!unica) unica = crearCacheBootstrap<FotoBootstrap>(ttlDeEntorno(process.env.BOOTSTRAP_CACHE_SEGUNDOS));
  return unica;
}

// La llaman las escrituras (lib/repo.ts). Si todavía nadie pidió un bootstrap no hay
// nada que botar, y por eso no fuerza la creación de la cache.
export function invalidarBootstrap(): void {
  unica?.invalidar();
}

// Cuántos segundos se puede reusar una carga. Se configura con BOOTSTRAP_CACHE_SEGUNDOS
// en Azure (sin desplegar), y `0` lo apaga del todo y deja el comportamiento de antes.
// El default es corto a propósito: con 10 s, una escritura que se olvidara de invalidar
// se corrige sola mucho antes del refresco de 45 s de la pantalla.
export function ttlDeEntorno(valor: string | undefined, porDefecto = 10): number {
  const txt = String(valor ?? "").trim();
  // Sin configurar es distinto de "0": `Number("")` da 0 y apagaría la cache sola.
  if (!txt) return porDefecto * 1000;
  const n = Number(txt);
  if (!Number.isFinite(n) || n < 0) return porDefecto * 1000;
  return Math.min(n, 60) * 1000;
}
