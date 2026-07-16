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
    .map((l) => ({ itemNo: l.articuloId!, cantidad: l.cantidad, precio: l.precioUnitario || 0, descripcion: l.descripcion, variantCode: l.variantCode }));
  // Cargos de producto (Item Charge): TODAS las líneas tipo "cargo" con precio, cada
  // una con su tipo (chargeNo). El codeunit las distribuye por importe entre los
  // artículos al registrar.
  const cargos = orden.lineas
    .filter((l) => l.tipo === "cargo" && (l.precioUnitario || 0) > 0)
    .map((l) => ({ chargeNo: l.chargeNo, descripcion: l.descripcion, cantidad: l.cantidad || 1, precio: l.precioUnitario || 0 }));
  // Método de asignación del cargo (Amount|Weight|Volume|Equally). Uno por orden.
  const metodoCargo = orden.lineas.find((l) => l.tipo === "cargo")?.chargeMethod || "Amount";

  // Sin proveedor de BC o sin líneas: no hay nada que enviar a BC; se lanza local.
  if (!orden.proveedorNo || !lineasBc.length) {
    await setOrdenEstado(orden.id, "lanzado");
    return { ok: true, tone: "success", message: `${orden.numero} aprobada y lanzada (sin envío a BC)` };
  }

  // Precio obligatorio: ninguna línea puede ir a BC en 0 (BC la deja sin costo).
  const sinPrecio = lineasBc.filter((l) => !(l.precio > 0));
  if (sinPrecio.length) {
    return { ok: false, tone: "error", message: `La orden tiene ${sinPrecio.length} línea(s) sin precio; no se envía a BC. Poné el precio en proveeduría antes de lanzar.` };
  }

  // Si la orden YA se creó en BC en un intento previo (tiene bcNumber pero el
  // release falló), NO se crea otra: solo se REINTENTA el release de ese pedido.
  // Así no se acumulan pedidos duplicados en BC en cada reintento.
  if (orden.bcNumber) {
    let res: Response;
    let d: any = {};
    try {
      // Re-sincroniza las líneas (precio + variante) del pedido YA creado en BC y
      // luego lanza. Así, si la orden se corrigió en la app después de crearse en
      // BC, esas correcciones viajan a BC en vez de relanzar la versión vieja.
      res = await fetch("/api/bc/relanzar", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ orderNo: orden.bcNumber, lineas: lineasBc, cargos, metodo: metodoCargo }),
      });
      d = await res.json().catch(() => ({}));
    } catch (e: any) {
      return { ok: false, tone: "error", message: `No se pudo contactar BC: ${String(e?.message ?? e)}. La orden queda pendiente.` };
    }
    if (!(res.ok && d.ok)) {
      return { ok: false, tone: "error", message: `No se lanzó ${orden.bcNumber} en BC: ${d.error || `HTTP ${res.status}`}. La orden queda pendiente.` };
    }
    await setOrdenEstado(orden.id, "lanzado", { bcNumber: orden.bcNumber });
    return { ok: true, tone: "success", message: `${orden.bcNumber} aprobada y lanzada en BC` };
  }

  // Primer intento: crear el pedido en BC y lanzarlo.
  let res: Response;
  let d: any = {};
  try {
    res = await fetch("/api/bc/lanzar", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ vendorNo: orden.proveedorNo, currencyCode: orden.currencyCode, locationCode: orden.almacenRecepcion || "ALM-GRAL", lineas: lineasBc, cargos, metodo: metodoCargo }),
    });
    d = await res.json().catch(() => ({}));
  } catch (e: any) {
    return { ok: false, tone: "error", message: `No se pudo contactar BC: ${String(e?.message ?? e)}. La orden queda pendiente.` };
  }

  // Si el pedido se CREÓ en BC (aunque el release falle), guardamos su número:
  // el próximo intento solo relanzará ese mismo pedido en vez de crear otro.
  if (res.ok && d.number) {
    if (d.released === true) {
      const aviso = Array.isArray(d.omitidas) && d.omitidas.length
        ? ` · ojo: BC omitió ${d.omitidas.length} línea(s): ${d.omitidas.join(", ")}`
        : "";
      await setOrdenEstado(orden.id, "lanzado", { bcNumber: d.number, bcDeepLink: d.deepLink || undefined });
      return { ok: true, tone: "success", message: `${d.number} aprobada y lanzada en BC${aviso}` };
    }
    // Creado pero no lanzado: persistimos el bcNumber sin cambiar el estado real.
    await setOrdenEstado(orden.id, orden.estado, { bcNumber: d.number, bcDeepLink: d.deepLink || undefined });
    return { ok: false, tone: "error", message: `${d.number} se creó en BC pero no se lanzó: ${d.releaseError || "sin detalle"}. Reintentá "Aprobar y lanzar" (no se creará otro).` };
  }

  // Ni siquiera se creó el pedido en BC.
  const motivo = d.lineError || d.error || `HTTP ${res.status}`;
  return { ok: false, tone: "error", message: `No se creó en BC: ${motivo}. La orden queda pendiente.` };
}
