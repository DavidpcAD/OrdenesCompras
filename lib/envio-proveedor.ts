// ============================================================================
// "¿Cuáles de las que me aprobaron el viernes ya se las mandé al proveedor?"
//
// Angie arma las órdenes, Aprobación (la app de Producción) las lanza, y ella les
// baja el PDF y se lo manda al proveedor. Con 60 aprobadas de una sola vez, lo que
// se pierde no es la orden: es SABER cuáles ya salieron. Eso no estaba en ningún
// lado, y la única manera honesta de contestarlo es marcando el momento en que la
// orden sale hacia afuera.
//
// Dónde vive: en la BITÁCORA (dbo.Movimiento), no en una columna nueva. Es un HECHO
// con fecha y persona ("Angie bajó el PDF de CP-005301 el viernes a las 3:14"), no
// un estado de la orden, y así no hace falta migración —el mismo camino que ya usan
// la devolución de una solicitud y la corrección del ingeniero—. La bitácora es un
// log: para saber cómo quedó la orden se lee el ÚLTIMO movimiento de envío, que
// puede ser justamente el de "quitá la marca, me equivoqué de fila".
// ============================================================================

import type { Orden } from "./types.ts";

// Tipos de movimiento del envío al proveedor.
export const MOV_PDF = "pdf_proveedor";          // bajó el PDF: la orden salió
export const MOV_ENVIADA = "enviada_proveedor";  // la marcó a mano (la mandó por WhatsApp, la volvió a mandar)
export const MOV_DESHECHO = "envio_deshecho";    // se equivocó de fila y quitó la marca
export const TIPOS_ENVIO = [MOV_PDF, MOV_ENVIADA, MOV_DESHECHO];

// Un SELLO es "la última vez que pasó X", comprimido en un solo texto para poder
// traerlo con un GROUP BY en vez de una consulta por orden (el bootstrap trae
// TODAS las órdenes, y la bitácora tiene un renglón por cada cosa que pasó).
//
// El truco es que el texto arranca con la fecha en ISO: así `MAX(...)` de SQL
// devuelve el movimiento más nuevo, porque en ISO el orden alfabético ES el
// cronológico. El separador es "|", que no aparece en una fecha ni en un nombre.
export const SELLO_SEP = "|";
export interface Sello { fecha: string; usuario?: string; tipo?: string }

export function leerSello(v: unknown): Sello | undefined {
  const s = typeof v === "string" ? v : "";
  if (!s) return undefined;
  const [fecha, usuario, tipo] = s.split(SELLO_SEP);
  if (!fecha) return undefined;
  return { fecha, usuario: usuario?.trim() || undefined, tipo: tipo?.trim() || undefined };
}

// Cómo quedó la orden según su último movimiento de envío. `envio_deshecho` gana:
// si lo último que hizo fue quitar la marca, la orden NO está enviada.
export function envioDeSello(s?: Sello): Orden["envioProveedor"] | undefined {
  if (!s || s.tipo === MOV_DESHECHO) return undefined;
  return { fecha: s.fecha, usuario: s.usuario, manual: s.tipo === MOV_ENVIADA };
}

// Al proveedor solo se le manda una orden aprobada (Lanzada) o ya completada: es
// el mismo candado del PDF (ver `ordenImprimible`), y define el universo del
// contador — una orden en borrador no "falta por enviar", todavía no existe afuera.
export function vaAlProveedor(o: Pick<Orden, "estado">): boolean {
  return o.estado === "lanzado" || o.estado === "completado";
}

export function ordenEnviada(o: Pick<Orden, "envioProveedor">): boolean {
  return !!o.envioProveedor?.fecha;
}

// El contador de la lista: sobre lo que se está VIENDO (ya filtrado por fecha de
// aprobación, por proveedor, por lo que sea), cuántas tienen que salir al
// proveedor, cuántas salieron y cuántas faltan. Esa resta es la pregunta de Angie.
export function resumenEnvio(ordenes: Pick<Orden, "estado" | "envioProveedor" | "aprobacion">[]) {
  const alProveedor = ordenes.filter(vaAlProveedor);
  const enviadas = alProveedor.filter(ordenEnviada).length;
  return {
    total: ordenes.length,
    alProveedor: alProveedor.length,
    enviadas,
    faltan: alProveedor.length - enviadas,
    // Cuántas de las que se ven traen fecha de aprobación. Si son cero teniendo
    // órdenes lanzadas a la vista, el filtro por fecha no puede prometer nada: la
    // pantalla lo dice en vez de mostrar una lista vacía sin explicación.
    conFechaAprobacion: ordenes.filter((o) => !!o.aprobacion?.fecha).length,
  };
}
