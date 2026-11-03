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
//  2. PROVEEDOR: Holcim, sea cual sea el monto. El cemento a granel se pide por
//     25 000 kg y la boleta trae 25 300 o 25 410: para registrar la factura exacta
//     Proveeduría reabre la orden, ajusta la cantidad y la reenvía. Antes cada
//     reenvío volvía a esperar a Luis por una diferencia de unos kilos; ahora sale
//     lanzada al toque. Es el ÚNICO proveedor con esta excepción.
//
// Luis igual ve todas estas órdenes: quedan en la bitácora como `aprobado_automatico`
// (con el motivo) y la app de Producción las lista en su histórico.
//
// Las reglas viven en código y no en variables de Azure a propósito: son decisiones
// del negocio, y la pantalla de envío las usa para avisar ANTES de mandar. Lo único
// que se puede tocar sin desplegar es el interruptor de emergencia
// APROBACION_AUTOMATICA=0, que manda todo otra vez a Luis.
import { money } from "./helpers.ts";

export const TOPE_SIN_APROBACION_CRC = 210_000;

// Código de BC → nombre corto con el que se dice en pantalla y en la bitácora.
export const PROVEEDORES_SIN_APROBACION: Record<string, string> = {
  "PROV-000694": "Holcim",
};

// Quién figura en la bitácora como el que aprobó. No es una persona, y tiene que
// leerse así en "Aprobada el … por …" de las dos apps.
export const USUARIO_APROBACION_AUTOMATICA = "Aprobación automática";
export const MOV_APROBACION_AUTOMATICA = "aprobado_automatico";

export type AprobacionAutomatica =
  | { aplica: true; motivo: "monto" | "proveedor"; detalle: string; aviso: string }
  | { aplica: false };

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
  o: { proveedorNo?: string; proveedorId?: string; currencyCode?: string },
  totales: { app: number; bc?: number | null },
): AprobacionAutomatica {
  const codigo = String(o.proveedorNo || o.proveedorId || "").trim().toUpperCase();
  const nombre = PROVEEDORES_SIN_APROBACION[codigo];
  if (nombre) {
    return {
      aplica: true, motivo: "proveedor",
      detalle: `Proveedor ${nombre} (${codigo}): sus órdenes se lanzan sin aprobación, para poder ajustar la cantidad a la boleta.`,
      aviso: `Las órdenes de ${nombre} no pasan por aprobación: quedó lanzada en Business Central.`,
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
export function avisoAntesDeEnviar(o: { proveedorNo?: string; proveedorId?: string; currencyCode?: string }, totalApp: number): string | null {
  if (!aprobacionAutomaticaActiva()) return null;
  const d = aprobacionAutomatica(o, { app: totalApp });
  if (!d.aplica) return null;
  return d.motivo === "proveedor"
    ? `${PROVEEDORES_SIN_APROBACION[String(o.proveedorNo || o.proveedorId || "").trim().toUpperCase()]} no pasa por aprobación: al enviarla queda lanzada en Business Central de una vez.`
    : `Es menor a ${tope()} con IVA: no pasa por aprobación. Al enviarla queda lanzada en Business Central de una vez.`;
}
