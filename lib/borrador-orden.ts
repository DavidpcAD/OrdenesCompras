/* ============================================================================
   Borrador AUTOMÁTICO de la orden que se está armando.

   El problema: armar una orden es un rato de trabajo —elegir líneas, poner
   precios, cantidades, obra y tarea, cargos— y todo eso vivía SOLO en memoria.
   Salirse de la pantalla, tocar "atrás" o recargar y no quedaba nada: había que
   volver a armarla desde cero (reportado por Proveeduría el 27 ago 2026).

   Qué NO es: esto no crea nada en la base ni en Business Central. Es la libreta
   de quien está armando, guardada en SU navegador. La orden nace cuando se
   guarda como Abierta, y llega a BC recién al enviarla a aprobación.

   Por qué en localStorage y no en el servidor: guardar en SQL a medio armar
   consumiría el saldo de las solicitudes por algo que todavía se está pensando,
   y llenaría la lista de órdenes de intentos. Para seguir desde otra computadora
   ya existe "Guardar como abierta".
   ============================================================================ */

/** Pantallas que arman una orden. Cada una guarda su propio borrador. */
export type PantallaBorrador = "nueva" | "directa";

export interface BorradorOrden<F = unknown> {
  v: number;              // versión del formato (si cambia el shape, se descarta lo viejo)
  ts: number;             // cuándo se guardó (epoch ms)
  usuario: string;        // de quién es: en una compu compartida no se mezclan
  proveedorId: string;
  currency: string;
  almacen: string;
  observaciones: string;
  notaInterna: string;
  metodoAsig: string;
  cargos: unknown[];
  filas: F[];
}

const VERSION = 1;
/** Una semana. Más viejo que eso son precios de otra realidad: no se ofrece. */
export const VIGENCIA_MS = 7 * 24 * 60 * 60 * 1000;

export function claveBorrador(pantalla: PantallaBorrador, usuario: string): string {
  return `adelante_oc_borrador_${pantalla}_${(usuario ?? "").trim().toLowerCase() || "anon"}`;
}

/**
 * Valida lo que había guardado. Devuelve null si no sirve: formato viejo, JSON
 * corrupto, de otra persona, vencido o sin líneas. Es la única puerta de entrada,
 * así que la pantalla nunca ve un borrador a medias.
 */
export function sanearBorrador<F>(crudo: unknown, usuario: string, ahora: number): BorradorOrden<F> | null {
  if (!crudo || typeof crudo !== "object") return null;
  const b = crudo as Partial<BorradorOrden<F>>;
  if (b.v !== VERSION) return null;
  if (!Array.isArray(b.filas) || b.filas.length === 0) return null;
  if (typeof b.ts !== "number" || !Number.isFinite(b.ts)) return null;
  if (ahora - b.ts > VIGENCIA_MS) return null;
  // El borrador es de quien lo armó. Sin esto, en la compu de bodega el siguiente
  // que entra se encuentra la orden a medio hacer de otro.
  const suyo = (b.usuario ?? "").trim().toLowerCase();
  if (suyo !== (usuario ?? "").trim().toLowerCase()) return null;
  return {
    v: VERSION,
    ts: b.ts,
    usuario: b.usuario ?? "",
    proveedorId: typeof b.proveedorId === "string" ? b.proveedorId : "",
    currency: typeof b.currency === "string" ? b.currency : "",
    almacen: typeof b.almacen === "string" ? b.almacen : "",
    observaciones: typeof b.observaciones === "string" ? b.observaciones : "",
    notaInterna: typeof b.notaInterna === "string" ? b.notaInterna : "",
    metodoAsig: typeof b.metodoAsig === "string" && b.metodoAsig ? b.metodoAsig : "Amount",
    cargos: Array.isArray(b.cargos) ? b.cargos : [],
    filas: b.filas as F[],
  };
}

/** "hace 5 minutos" / "hace 2 horas" / "ayer" — para que el aviso diga de cuándo es. */
export function hace(ts: number, ahora: number): string {
  const min = Math.max(0, Math.round((ahora - ts) / 60000));
  if (min < 1) return "recién";
  if (min < 60) return `hace ${min} min`;
  const h = Math.round(min / 60);
  if (h < 24) return `hace ${h} h`;
  const d = Math.round(h / 24);
  return d === 1 ? "de ayer" : `hace ${d} días`;
}

// ---- acceso al navegador (todo protegido: sin window en SSR, y el storage puede
// estar lleno o bloqueado por el navegador) --------------------------------------

export function leerBorrador<F>(pantalla: PantallaBorrador, usuario: string | null): BorradorOrden<F> | null {
  if (typeof window === "undefined" || !usuario) return null;
  try {
    const raw = window.localStorage.getItem(claveBorrador(pantalla, usuario));
    if (!raw) return null;
    return sanearBorrador<F>(JSON.parse(raw), usuario, Date.now());
  } catch { return null; }
}

export function guardarBorrador<F>(
  pantalla: PantallaBorrador, usuario: string | null,
  datos: Omit<BorradorOrden<F>, "v" | "ts" | "usuario">,
): void {
  if (typeof window === "undefined" || !usuario) return;
  try {
    // Sin líneas no hay nada que rescatar, y guardar un cascarón vacío haría que la
    // próxima visita crea que hay algo. Se borra en vez de guardar.
    if (!datos.filas?.length) { borrarBorrador(pantalla, usuario); return; }
    const b: BorradorOrden<F> = { v: VERSION, ts: Date.now(), usuario, ...datos };
    window.localStorage.setItem(claveBorrador(pantalla, usuario), JSON.stringify(b));
  } catch { /* storage lleno o bloqueado: no se pierde nada más que el rescate */ }
}

export function borrarBorrador(pantalla: PantallaBorrador, usuario: string | null): void {
  if (typeof window === "undefined" || !usuario) return;
  try { window.localStorage.removeItem(claveBorrador(pantalla, usuario)); } catch { /* idem */ }
}
