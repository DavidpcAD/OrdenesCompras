// ── CUÁNDO UNA ORDEN SE LANZA SIN PASAR POR APROBACIÓN ──────────────────────
//
// Desde nov 2026 no todo le llega a Luis Roberto. Al ENVIAR la orden a aprobación,
// esta app crea el pedido en Business Central y, si la orden cae en una de estas dos
// reglas, lo LANZA ella misma en ese mismo momento (AdelantePO_ReleaseOrder, como
// la cuenta de servicio de la app):
//
//  1. MONTO: órdenes en COLONES cuyo total con IVA es menor a ₡210 000. Es el total
//     que se paga y el mismo monto que Luis ve en su bandeja. Con datos de BC del
//     1 sep al 2 nov 2026 eran 668 de 1 164 pedidos en colones (57 %), pero apenas
//     ₡56 M de ₡488 M: la bandeja se achica a menos de la mitad y lo que pesa en
//     plata sigue pasando por él.
//     Las órdenes en dólares o euros van SIEMPRE a aprobación (decisión de David):
//     son pocas, casi todas importaciones, y compararlas contra un tope en colones
//     obligaría a usar un tipo de cambio que se mueve todos los días.
//
//  2. PROVEEDOR + MATERIAL: Holcim, sea cual sea el monto, pero SOLO cuando la orden
//     lleva únicamente CEMENTO INDUSTRIAL a granel (por kilos). Ese cemento se pide
//     por 25 000 kg y la boleta trae 25 300 o 25 410: para registrar la factura
//     exacta Proveeduría reabre la orden, ajusta la cantidad y la reenvía, y cada
//     reenvío volvía a esperar a Luis por una diferencia de unos kilos. Cualquier
//     otra orden de Holcim (cemento en sacos, por ejemplo) sigue la regla 1 como la
//     de cualquier proveedor: por encima del tope va a aprobación (decisión de David,
//     11 nov 2026, después de una de sacos por encima del tope que salió sola).
//     Es el ÚNICO proveedor con esta excepción.
//
//  3. YA APROBADA Y CORREGIDA POR EL INGENIERO: Luis ya la había aprobado, Proveeduría
//     la reabrió y se la devolvió al ingeniero, y el ingeniero la corrigió él mismo
//     desde Producción (hoy, los subcontratos: la corrección vuelve directo a esta
//     orden). Lo que Luis firmó era esta orden; volver a mandársela por la corrección
//     era hacerle firmar dos veces lo mismo (PED-001171 / CP-006835, 24 nov 2026,
//     decisión de David: "si ya había sido aprobada, cuando la corrijan debería
//     lanzarse de una vez"). Solo si la corrección es lo ÚLTIMO que le pasó: si
//     después alguien la editó, la reenvió o la rechazaron, va a aprobación como
//     cualquier otra. Y solo si la última aprobación fue de una persona: una que salió
//     por las reglas 1 o 2 no la firmó nadie.
//
// Luis igual ve todas estas órdenes: quedan en la bitácora como `aprobado_automatico`
// (con el motivo) y la app de Producción las lista en su histórico.
//
// Las reglas viven en código y no en variables de Azure a propósito: son decisiones
// del negocio, y la pantalla de envío las usa para avisar ANTES de mandar. Lo único
// que se puede tocar sin desplegar es el interruptor de emergencia
// APROBACION_AUTOMATICA=0, que manda todo otra vez a Luis.
import { money } from "./helpers.ts";
import { codigoDeItem } from "./unidad.ts";

export const TOPE_SIN_APROBACION_CRC = 210_000;

// Código de BC → nombre corto con el que se dice en pantalla y en la bitácora.
export const PROVEEDORES_SIN_APROBACION: Record<string, string> = {
  "PROV-000694": "Holcim",
};
// Y los ÚNICOS artículos con los que esa excepción vale: la orden tiene que llevar
// solo estos (ni otro material ni una línea de cargo). M10-0047 = cemento industrial
// a granel, por kilos. Ojo: hay otro "CEMENTO INDUSTRIAL" en sacos (otro código) que
// NO entra: se decide por el código, no por la descripción.
export const ARTICULOS_SIN_APROBACION: Record<string, string[]> = {
  "PROV-000694": ["M10-0047"],
};
const NOMBRE_ARTICULOS_SIN_APROBACION: Record<string, string> = {
  "PROV-000694": "cemento industrial a granel",
};

// Las líneas con las que se decide (las de la orden, o las filas de la pantalla).
export type LineaParaRegla = { tipo?: string; articuloId?: string };
function soloArticulosDeLaExcepcion(codigoProv: string, lineas: LineaParaRegla[] | undefined): boolean {
  const permitidos = ARTICULOS_SIN_APROBACION[codigoProv];
  // Sin lista de artículos, o sin líneas para mirar, la excepción no se da: en la
  // duda la orden va a aprobación.
  if (!permitidos?.length || !lineas?.length) return false;
  return lineas.every((l) => (l.tipo ?? "articulo") === "articulo"
    && permitidos.includes(codigoDeItem(String(l.articuloId ?? "")).toUpperCase()));
}

// Quién figura en la bitácora como el que aprobó. No es una persona, y tiene que
// leerse así en "Aprobada el … por …" de las dos apps.
export const USUARIO_APROBACION_AUTOMATICA = "Aprobación automática";
export const MOV_APROBACION_AUTOMATICA = "aprobado_automatico";

export type AprobacionAutomatica =
  | { aplica: true; motivo: "monto" | "proveedor" | "corregida"; detalle: string; aviso: string }
  | { aplica: false };

// ── REGLA 3: la corrección del ingeniero sobre una orden ya aprobada ──
//
// La marca la escribe la app de PRODUCCIÓN en dbo.Movimiento cuando el ingeniero
// corrige un subcontrato cuya orden vive en BC (`updateSubcontrato` en su
// lib/compras/repo.ts): tipo "editado", detalle "Subcontrato PED-… corregido por el
// ingeniero · …". Si allá cambia ese texto, cambia esta marca con él (mismo trato que
// "Devuelta desde la orden", que va en sentido contrario).
export const MARCA_CORRECCION_INGENIERO = "corregido por el ingeniero";

// Lo que la regla necesita de la orden. `correccionIngeniero.ultima` = la corrección
// es lo último que le pasó (nadie la editó, reenvió, rechazó ni lanzó después); lo
// arma el repo desde la bitácora (`sellosDeOrdenes`).
export type OrdenParaCorreccion = {
  estado?: string;
  bcNumber?: string;
  lineas?: LineaParaRegla[];
  aprobacion?: { fecha: string; usuario?: string };
  correccionIngeniero?: { fecha: string; usuario?: string; ultima: boolean; rechazo?: string };
};
export type CorreccionYaAprobada = {
  aprobadaPor?: string; fechaAprobacion: string;
  corregidaPor?: string; fechaCorreccion: string;
};

export function correccionYaAprobada(o: OrdenParaCorreccion): CorreccionYaAprobada | null {
  const c = o.correccionIngeniero;
  const ap = o.aprobacion;
  if (o.estado !== "abierto" || !o.bcNumber || !c?.ultima || !ap?.fecha) return null;
  // Sin nada que comprar no hay qué lanzar (es la orden que todavía espera).
  if (!o.lineas?.some((l) => (l.tipo ?? "articulo") !== "cargo")) return null;
  // La última vez salió sola (reglas 1 o 2): nadie la firmó, así que no hay firma
  // que respetar. Va a aprobación, y ahí las reglas 1 y 2 deciden de nuevo.
  if ((ap.usuario ?? "").trim() === USUARIO_APROBACION_AUTOMATICA) return null;
  // La corrección tiene que ser POSTERIOR a la aprobación.
  const tAp = Date.parse(ap.fecha), tCo = Date.parse(c.fecha);
  if (!Number.isFinite(tAp) || !Number.isFinite(tCo) || tCo <= tAp) return null;
  // Luis la RECHAZÓ después de aprobarla (le dijo que no a una versión más nueva): la
  // firma vieja ya no cubre lo que se corrija ahora. Vuelve a él.
  const tRe = c.rechazo ? Date.parse(c.rechazo) : NaN;
  if (Number.isFinite(tRe) && tRe > tAp) return null;
  return { aprobadaPor: ap.usuario || undefined, fechaAprobacion: ap.fecha, corregidaPor: c.usuario || undefined, fechaCorreccion: c.fecha };
}

// Fecha y hora de Costa Rica aunque corra en el servidor (UTC): este texto queda en la
// bitácora y lo lee Luis.
const fechaCr = (iso: string) => new Date(iso).toLocaleString("es-CR", {
  timeZone: "America/Costa_Rica", day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit",
});

// Encendida salvo que alguien la apague a propósito y bien escrito (mismo criterio
// que los frenos de BC): un typo en Azure no puede cambiar quién aprueba.
export function aprobacionAutomaticaActiva(): boolean {
  const v = (typeof process !== "undefined" ? process.env?.APROBACION_AUTOMATICA ?? "" : "").trim().toLowerCase();
  return !(v === "0" || v === "false" || v === "no");
}

// "" es colones en la app; BC a veces manda "CRC" para lo mismo.
export function esMonedaLocal(currencyCode?: string): boolean {
  const c = (currencyCode ?? "").trim().toUpperCase();
  return c === "" || c === "CRC";
}

const tope = () => money(TOPE_SIN_APROBACION_CRC, "");

// `totales.app` es el estimado de la orden (`ordenTotalConIva`). `totales.bc`:
//   undefined → no se le preguntó a BC (la pantalla, antes de enviar): se decide con
//               el estimado y nada más.
//   null      → se le preguntó y no contestó: la regla del MONTO no aplica. El IVA lo
//               pone BC y puede dar más que el estimado (CP-005652 cobró 13 % donde la
//               orden decía 1 %); sin verlo no se lanza nada a nombre de Luis.
//   número    → manda el MAYOR de los dos.
export function aprobacionAutomatica(
  o: { proveedorNo?: string; proveedorId?: string; currencyCode?: string; lineas?: LineaParaRegla[] } & OrdenParaCorreccion,
  totales: { app: number; bc?: number | null },
): AprobacionAutomatica {
  // Regla 3 primero: no depende del monto ni de la moneda (Luis ya firmó esta orden).
  const corr = correccionYaAprobada(o);
  if (corr) {
    const quien = corr.aprobadaPor || "Aprobación";
    const ing = corr.corregidaPor || "el ingeniero";
    return {
      aplica: true, motivo: "corregida",
      detalle: `Ya la había aprobado ${quien} el ${fechaCr(corr.fechaAprobacion)}; ${ing} la corrigió el ${fechaCr(corr.fechaCorreccion)}: se lanzó sin volver a aprobación.`,
      aviso: `Ya la había aprobado ${quien} y ${ing} la corrigió: el pedido ${o.bcNumber} quedó actualizado y lanzado en Business Central, sin volver a aprobación.`,
    };
  }
  const codigo = String(o.proveedorNo || o.proveedorId || "").trim().toUpperCase();
  const nombre = PROVEEDORES_SIN_APROBACION[codigo];
  // Holcim CON solo cemento industrial a granel. Cualquier otra orden suya sigue
  // abajo, por el monto, como la de cualquier proveedor.
  if (nombre && soloArticulosDeLaExcepcion(codigo, o.lineas)) {
    const que = NOMBRE_ARTICULOS_SIN_APROBACION[codigo] ?? "los artículos de la excepción";
    return {
      aplica: true, motivo: "proveedor",
      detalle: `Proveedor ${nombre} (${codigo}) con solo ${que}: se lanza sin aprobación, para poder ajustar la cantidad a la boleta.`,
      aviso: `Las órdenes de ${nombre} de solo ${que} no pasan por aprobación: quedó lanzada en Business Central.`,
    };
  }
  if (!esMonedaLocal(o.currencyCode)) return { aplica: false };
  if (totales.bc === null) return { aplica: false };
  const monto = Math.max(Number(totales.app) || 0, Number(totales.bc) || 0);
  if (!(monto > 0) || monto >= TOPE_SIN_APROBACION_CRC) return { aplica: false };
  return {
    aplica: true, motivo: "monto",
    detalle: `Total con IVA ${money(monto, "")}, menor a ${tope()}: se lanzó sin aprobación.`,
    aviso: `El total con IVA (${money(monto, "")}) es menor a ${tope()}: no pasa por aprobación y quedó lanzada en Business Central.`,
  };
}

// Lo que dice el diálogo de envío antes de confirmar. Solo con el estimado de la
// orden: si BC termina cobrando más, el servidor la manda a aprobación igual y lo dice.
export function avisoAntesDeEnviar(o: { proveedorNo?: string; proveedorId?: string; currencyCode?: string; lineas?: LineaParaRegla[] } & OrdenParaCorreccion, totalApp: number): string | null {
  if (!aprobacionAutomaticaActiva()) return null;
  const d = aprobacionAutomatica(o, { app: totalApp });
  if (!d.aplica) return null;
  if (d.motivo === "corregida") {
    const corr = correccionYaAprobada(o);
    return `Ya la aprobó ${corr?.aprobadaPor || "Aprobación"} y ${corr?.corregidaPor || "el ingeniero"} la corrigió: no vuelve a aprobación. Al lanzarla, el pedido ${o.bcNumber} de Business Central se reescribe con estas líneas y queda lanzado de una vez.`;
  }
  const cod = String(o.proveedorNo || o.proveedorId || "").trim().toUpperCase();
  return d.motivo === "proveedor"
    ? `${PROVEEDORES_SIN_APROBACION[cod]} con solo ${NOMBRE_ARTICULOS_SIN_APROBACION[cod] ?? "estos artículos"} no pasa por aprobación: al enviarla queda lanzada en Business Central de una vez.`
    : `Es menor a ${tope()} con IVA: no pasa por aprobación. Al enviarla queda lanzada en Business Central de una vez.`;
}
