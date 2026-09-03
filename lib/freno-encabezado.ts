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
import { frenoProveedorActivo, verificarEncabezadoDelPedido, type FrenoEncabezado } from "./bc.ts";

export type AccionRegistro = "recibir" | "facturar" | "registrar";

const COMO_EMPIEZA: Record<AccionRegistro, string> = {
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

export async function proveedorEsperadoDeOrden(ordenId: unknown, vendorNoBody: unknown): Promise<string> {
  const id = Number(ordenId ?? 0);
  if (id > 0) {
    try {
      const o = await getOrden(id);
      if (o?.proveedorNo) return String(o.proveedorNo);
      if (o?.proveedorId) return String(o.proveedorId);
    } catch { /* si la base no contesta, queda el respaldo del body */ }
  }
  return String(vendorNoBody ?? "");
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
): Promise<Freno409 | null> {
  if (!frenoProveedorActivo()) return null;
  const esperado = await proveedorEsperadoDeOrden(ordenId, vendorNoBody);
  const r: FrenoEncabezado = await verificarEncabezadoDelPedido(String(orderNo ?? ""), esperado)
    // Un fallo del propio chequeo no puede trabar el registro: se comporta como
    // "no se pudo verificar", igual que cuando BC no contesta.
    .catch(() => ({ ok: true, verificado: false }));
  if (r.ok || !r.problema) return null;
  return {
    ok: false,
    error: `${COMO_EMPIEZA[accion]}: ${r.mensaje}.\n\n${QUE_SIGUE[r.problema]}`,
    frenoEncabezado: true,
    ...(r.problema === "proveedor" ? { frenoProveedor: true as const } : { frenoNoLanzado: true as const }),
    bcVendorNo: r.bcVendorNo,
    bcVendorName: r.bcVendorName,
    bcEstado: r.bcEstado,
  };
}
