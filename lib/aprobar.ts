// Aprobar y lanzar una orden en Business Central — fuente de verdad ÚNICA para
// la lista y el detalle de Aprobación. Regla clave: la orden solo pasa a "lanzado"
// si BC realmente la creó CON líneas y la lanzó (released=true). Si BC falla o
// rechaza las líneas, la orden queda como estaba (pendiente) y se devuelve el
// motivo real, para que el estado en SQL/UI nunca mienta respecto a BC.
import type { Orden } from "./types";

type SetOrdenEstado = (
  id: string,
  estado: Orden["estado"],
  extra?: { bcNumber?: string; bcDeepLink?: string },
) => Promise<void>;

export async function aprobarYLanzar(
  orden: Orden,
  setOrdenEstado: SetOrdenEstado,
): Promise<{ ok: boolean; message: string; tone: "success" | "error" }> {
  const lineasBc = orden.lineas
    .filter((l) => l.tipo === "articulo" && l.articuloId && l.cantidad > 0)
    .map((l) => ({ itemNo: l.articuloId!, cantidad: l.cantidad, precio: l.precioUnitario || 0, descripcion: l.descripcion }));

  // Sin proveedor de BC o sin líneas: no hay nada que enviar a BC; se lanza local.
  if (!orden.proveedorNo || !lineasBc.length) {
    await setOrdenEstado(orden.id, "lanzado");
    return { ok: true, tone: "success", message: `${orden.numero} aprobada y lanzada (sin envío a BC)` };
  }

  let res: Response;
  let d: any = {};
  try {
    res = await fetch("/api/bc/lanzar", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ vendorNo: orden.proveedorNo, currencyCode: orden.currencyCode, locationCode: orden.almacenRecepcion || "ALM-GRAL", lineas: lineasBc }),
    });
    d = await res.json().catch(() => ({}));
  } catch (e: any) {
    return { ok: false, tone: "error", message: `No se pudo contactar BC: ${String(e?.message ?? e)}. La orden queda pendiente.` };
  }

  // Solo es éxito si BC devolvió creada Y lanzada.
  if (!(res.ok && d.released === true)) {
    const motivo = d.releaseError || d.lineError || d.error || `HTTP ${res.status}`;
    return { ok: false, tone: "error", message: `No se lanzó en BC: ${motivo}. La orden queda pendiente.` };
  }

  const aviso = Array.isArray(d.omitidas) && d.omitidas.length
    ? ` · ojo: BC omitió ${d.omitidas.length} línea(s): ${d.omitidas.join(", ")}`
    : "";
  await setOrdenEstado(orden.id, "lanzado", { bcNumber: d.number || undefined, bcDeepLink: d.deepLink || undefined });
  return { ok: true, tone: "success", message: `${d.number || orden.numero} aprobada y lanzada en BC${aviso}` };
}
