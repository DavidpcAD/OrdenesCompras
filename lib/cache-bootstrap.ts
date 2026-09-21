// LA ÚLTIMA CARGA, GUARDADA EN EL NAVEGADOR.
//
// Abrir la app —o recargar con F5— arrancaba SIEMPRE en cero: los recuadros en 0, la
// tabla en huesitos y nada que leer hasta que llegara el bootstrap entero. Y el
// bootstrap no es chico: 1,2 MB de solicitudes, órdenes y recepciones que el servidor
// arma en 1 a 3 segundos (medido en el log de Azure: `[bootstrap] … ms · … kB`). En
// una pantalla que se abre veinte veces al día, esos segundos son LA impresión de que
// la app es lenta, aunque la red esté bien.
//
// Acá se guarda la última respuesta con su ETag. Al abrir, la app pinta con eso de una
// y pregunta por detrás; como manda el ETag, el servidor casi siempre contesta 304 y
// no baja un solo byte de datos. Lo que se ve primero puede tener unos minutos, y por
// eso la barra de arriba sigue diciendo "Actualizando…" hasta que contesta.
//
// QUÉ NO SE GUARDA NUNCA: lo de otra persona —la caché lleva el usuario y se ignora si
// no coincide, para que cambiar de cuenta no muestre las órdenes del anterior— ni lo
// de ayer: vence a las doce horas, porque abrir la app con los números del día
// anterior es peor que esperar. Se borra al salir y cuando la sesión vence.

export const CLAVE_CACHE_BOOTSTRAP = "adelante_oc_bootstrap";

// Subir cuando cambie la FORMA del payload (un campo nuevo que la pantalla da por
// seguro, por ejemplo): así una caché vieja se descarta sola en vez de pintar mal.
export const VERSION_CACHE = 1;

// Doce horas: cubre la jornada —salir a almorzar, cerrar la tapa, volver— y no cruza
// la noche.
export const VIDA_CACHE_MS = 12 * 60 * 60 * 1000;

export type CacheBootstrap = { v: number; usuario: string; etag: string | null; t: number; body: string };

export const serializarCache = (usuario: string, etag: string | null, body: string, ahora: number): string =>
  JSON.stringify({ v: VERSION_CACHE, usuario, etag, t: ahora, body } satisfies CacheBootstrap);

// Devuelve la caché solo si es de ESTE usuario, de esta versión y de hace poco.
// Tolerante a propósito: cualquier cosa rara devuelve null y la app carga como
// siempre. Una caché ilegible no puede ser nunca una pantalla rota.
export function leerCache(raw: string | null, usuario: string, ahora: number): { etag: string | null; body: string; t: number } | null {
  if (!raw || !usuario) return null;
  try {
    const c = JSON.parse(raw) as Partial<CacheBootstrap>;
    if (!c || c.v !== VERSION_CACHE) return null;
    if (typeof c.body !== "string" || !c.body) return null;
    if (c.usuario !== usuario) return null;
    if (typeof c.t !== "number" || !Number.isFinite(c.t)) return null;
    // Con el reloj movido hacia atrás se descarta: esperar es peor que pintar algo
    // viejo, pero nunca tanto como pintar algo de fecha desconocida.
    if (c.t > ahora || ahora - c.t >= VIDA_CACHE_MS) return null;
    // `t` vuelve para poder decir DE CUÁNDO es lo que se está pintando mientras el
    // servidor contesta (la barra de arriba y el aviso de "no se pudo confirmar").
    return { etag: typeof c.etag === "string" ? c.etag : null, body: c.body, t: c.t };
  } catch {
    return null;
  }
}

// Al salir y cuando la sesión vence: lo que se vio no se queda esperando al próximo
// que abra el navegador.
export function borrarCacheBootstrap(): void {
  try { localStorage.removeItem(CLAVE_CACHE_BOOTSTRAP); } catch { /* sin storage */ }
}
