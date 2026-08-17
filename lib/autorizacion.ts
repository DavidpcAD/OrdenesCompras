import type { Role } from "./types";

/* ============================================================================
   Qué puede ESCRIBIR cada rol en la API.

   El middleware ya exigía sesión, pero no miraba el rol: con la cookie de su
   sesión, cualquiera podía llamar cualquier `/api/*` a mano (p. ej. Bodega
   creando una orden de compra). Las pantallas sí respetan el rol, pero eso es
   solo la UI.

   Criterios:
   - **Las LECTURAS quedan abiertas.** Los tres ven las mismas órdenes y varias
     pantallas comparten el detalle; restringir GETs solo rompería cosas.
   - **Ruta no listada = no se bloquea** (fail-open a propósito): preferimos no
     tumbar un flujo que no mapeé antes que "cerrar" a ciegas. Lo que está
     listado es lo que escribe datos del negocio.
   - Se puede apagar sin redeploy con el App Setting `AUTORIZACION_ROLES=0`.
   ============================================================================ */

type Regla = { prefijo: string; metodos?: string[]; roles: Role[]; nota?: string };

const ESCRITURA = ["POST", "PUT", "PATCH", "DELETE"];

const REGLAS: Regla[] = [
  // ---- Proveeduría (Angie): armar órdenes y mover solicitudes ----
  { prefijo: "/api/ordenes", metodos: ESCRITURA, roles: ["proveeduria"] },
  { prefijo: "/api/pedidos", metodos: ESCRITURA, roles: ["proveeduria"] },

  // ---- Contabilidad (Kattya) ----
  // Modo 2: ponerle el número a una factura que Bodega dejó EN REVISIÓN. Lo hace
  // solo Kattya (confirmado por David).
  { prefijo: "/api/recepciones/", metodos: ["PATCH"], roles: ["contabilidad"], nota: "registrar factura en revisión" },
  { prefijo: "/api/bc/facturar-recibido", roles: ["contabilidad"], nota: "facturar en BC lo ya recibido" },
  { prefijo: "/api/notas-credito/", metodos: ["PATCH"], roles: ["contabilidad"], nota: "acreditar / reabrir una NC" },
  { prefijo: "/api/bc/cargo-recibido", roles: ["contabilidad"], nota: "cargo de un tercero sobre recepción registrada" },

  // ---- Bodega (Pedro) — y Contabilidad, porque la pantalla de recibir tiene una
  // variante hecha a propósito para ella (edita las tres fechas, tabla de
  // escritorio). Si Kattya NO debe registrar recepciones, sacar "contabilidad"
  // de estas tres reglas y esconderle la pantalla.
  { prefijo: "/api/recepciones", metodos: ["POST"], roles: ["facturacion", "contabilidad"], nota: "registrar recepción" },
  { prefijo: "/api/bc/registrar", roles: ["facturacion", "contabilidad"], nota: "recibir + facturar en BC" },
  { prefijo: "/api/bc/recibir", roles: ["facturacion", "contabilidad"], nota: "solo recibir en BC" },
  { prefijo: "/api/notas-credito", metodos: ["POST"], roles: ["facturacion", "contabilidad"], nota: "marcar líneas para NC" },
];

/** ¿Está activa la autorización por rol? Se apaga con AUTORIZACION_ROLES=0. */
export const autorizacionActiva = (): boolean => process.env.AUTORIZACION_ROLES !== "0";

/** Regla que aplica a esta ruta+método (o null si no hay ninguna). */
export function reglaPara(pathname: string, metodo: string): Regla | null {
  const m = (metodo || "GET").toUpperCase();
  return REGLAS.find((r) => pathname.startsWith(r.prefijo) && (!r.metodos || r.metodos.includes(m))) ?? null;
}

/** true = puede seguir. Las lecturas y las rutas no listadas siempre pasan. */
export function rolPuede(pathname: string, metodo: string, rol: Role | undefined): boolean {
  const m = (metodo || "GET").toUpperCase();
  if (!ESCRITURA.includes(m)) return true;
  const regla = reglaPara(pathname, m);
  if (!regla) return true;
  return !!rol && regla.roles.includes(rol);
}

/** Mensaje para el 403 (lo muestra el toast de la pantalla). */
export function mensajeNoAutorizado(pathname: string, metodo: string): string {
  const r = reglaPara(pathname, metodo);
  const quien = r ? r.roles.map((x) => (x === "facturacion" ? "Bodega" : x === "contabilidad" ? "Contabilidad" : "Proveeduría")).join(" o ") : "otro rol";
  return `Tu rol no puede hacer esta acción${r?.nota ? ` (${r.nota})` : ""}: es de ${quien}.`;
}
