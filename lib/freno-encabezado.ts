// FRENO DE ENCABEZADO — el guard que les faltaba a los tres caminos que registran
// en Business Central (recibir, registrar factura, facturar lo recibido).
//
// Comprueba las dos cosas del encabezado del pedido de BC que la app venía dando
// por sentadas, en UNA sola lectura (ver `verificarEncabezadoDelPedido` en lib/bc.ts):
//
//   · PROVEEDOR  — que el pedido siga siendo del proveedor de la orden (CP-005183).
//   · LANZAMIENTO — que en BC esté LANZADO. Quien lanza es la app de Aprobación
//     (produccion.adelante.cr); esta app solo se entera de que "quedó aprobada" y
//     antes se lo creía sin preguntar (CP-005143).
//
// El proveedor esperado se resuelve del lado del SERVIDOR (leyendo la orden en la
// base) y no de lo que mande el navegador: un freno que depende del cliente no es
// un freno. `vendorNo` del body queda solo como respaldo para los llamados viejos
// que todavía no mandan `ordenId`.
import { getOrden } from "./repo.ts";
import type { Orden } from "./types.ts";
import { frenoProveedorActivo, verificarEncabezadoDelPedido, type FrenoEncabezado, type EstadoBcPedido } from "./bc.ts";

export type AccionRegistro = "recibir" | "facturar" | "registrar";

// Cómo empieza el "no" de cada camino. Lo usa también el freno de precio
// (lib/freno-precio.ts): los dos cortan lo mismo y tienen que sonar igual.
export const COMO_EMPIEZA: Record<AccionRegistro, string> = {
  recibir: "NO se recibió",
  facturar: "NO se facturó",
  registrar: "NO se registró",
};

// Qué hacer con cada problema. Son dos historias distintas y no se pueden contar
// igual: una es "esto está mal, avisá a Proveeduría"; la otra es "esto todavía no
// pasó, falta un paso de Aprobación".
const QUE_SIGUE: Record<NonNullable<FrenoEncabezado["problema"]>, string> = {
  proveedor:
    "Revisalo en BC antes de reintentar. Si el pedido de allá es el equivocado, corregí el N.º de BC de la orden; "
    + "si a este pedido le cambiaron el proveedor, hay que arreglarlo en Business Central.",
  "no-lanzado":
    "No es un error tuyo ni hace falta reintentar todavía: pedile a Aprobación que lance el pedido en Business Central "
    + "y volvé a intentar cuando esté Lanzado.",
};

// La orden viaja de vuelta además del proveedor: el freno de PRECIO la necesita
// entera (líneas y moneda) y leerla otra vez sería repetir cinco consultas en la
// pantalla más lenta de la app.
export async function proveedorEsperadoDeOrden(
  ordenId: unknown, vendorNoBody: unknown,
): Promise<{ esperado: string; orden: Orden | null }> {
  const id = Number(ordenId ?? 0);
  if (id > 0) {
    try {
      const o = await getOrden(id);
      if (o?.proveedorNo) return { esperado: String(o.proveedorNo), orden: o };
      if (o?.proveedorId) return { esperado: String(o.proveedorId), orden: o };
      if (o) return { esperado: String(vendorNoBody ?? ""), orden: o };
    } catch { /* si la base no contesta, queda el respaldo del body */ }
  }
  return { esperado: String(vendorNoBody ?? ""), orden: null };
}

export type Freno409 = {
  ok: false; error: string; frenoEncabezado: true;
  frenoProveedor?: true; frenoNoLanzado?: true;
  bcVendorNo?: string; bcVendorName?: string; bcEstado?: string;
};

// Devuelve null cuando se puede seguir; si no, el cuerpo del 409 listo para responder.
export async function frenarPorEncabezado(
  orderNo: unknown,
  ordenId: unknown,
  vendorNoBody: unknown,
  accion: AccionRegistro,
): Promise<{ freno: Freno409 | null; estadoBc?: EstadoBcPedido; orden?: Orden | null }> {
  // Con el freno apagado la orden igual se lee: la necesita el freno de precio, que
  // tiene su propio interruptor y no se apaga con este.
  const { esperado, orden } = await proveedorEsperadoDeOrden(ordenId, vendorNoBody);
  if (!frenoProveedorActivo()) return { freno: null, orden };
  const r: FrenoEncabezado = await verificarEncabezadoDelPedido(String(orderNo ?? ""), esperado)
    // Un fallo del propio chequeo no puede trabar el registro: se comporta como
    // "no se pudo verificar", igual que cuando BC no contesta.
    .catch(() => ({ ok: true, verificado: false }));
  // El estado que se leyó acá viaja de vuelta aunque el freno deje pasar: es la
  // única constancia de cómo estaba el pedido ANTES del posteo, y con eso se puede
  // reponer el lanzamiento si el posteo lo des-lanza (ver reponerLanzamientoTrasFallo).
  if (r.ok || !r.problema) return { freno: null, estadoBc: r.bcEstado, orden };
  return { freno: {
    ok: false,
    error: `${COMO_EMPIEZA[accion]}: ${r.mensaje}.\n\n${QUE_SIGUE[r.problema]}`,
    frenoEncabezado: true,
    ...(r.problema === "proveedor" ? { frenoProveedor: true as const } : { frenoNoLanzado: true as const }),
    bcVendorNo: r.bcVendorNo,
    bcVendorName: r.bcVendorName,
    bcEstado: r.bcEstado,
  }, estadoBc: r.bcEstado, orden };
}
