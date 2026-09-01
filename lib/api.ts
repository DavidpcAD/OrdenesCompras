// Cliente del front-end para las API routes (modo API).
import type { Orden, Pedido, Recepcion, NotaCreditoLinea } from "./types";

export const USE_API = process.env.NEXT_PUBLIC_USE_API === "1";

async function jsonOrThrow(res: Response) {
  if (!res.ok) {
    // El 401 (sesión vencida) lo maneja lib/fetch-guard.ts para TODA la app —
    // también para los fetch sueltos que no pasan por acá. Acá solo se traduce
    // el error para que la pantalla pueda decir algo con sentido.
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error ?? `HTTP ${res.status}`);
  }
  return res.json();
}

export interface Bootstrap {
  pedidos: Pedido[];
  ordenes: Orden[];
  recepciones: Recepcion[];
  // Van en el mismo viaje que el resto: así el ETag las cubre y una NC nueva
  // invalida la caché igual que una orden nueva (antes eran un request aparte
  // que las pantallas pedían solo al montar).
  notas: NotaCreditoLinea[];
}

// ETag del último bootstrap recibido. El servidor calcula la "versión" de los datos
// con una consulta barata (conteos + última modificación) y contesta 304 si nada
// cambió: el poll de 45 s deja de bajar TODAS las órdenes y líneas cada vez.
let etagBootstrap: string | null = null;
// Un solo bootstrap a la vez: el refresco se dispara por varias vías (poll, volver
// a la pestaña, cambiar de pantalla) y dos llegando juntos hacían el mismo trabajo
// de SQL dos veces.
let bootstrapEnVuelo: Promise<Bootstrap | null> | null = null;

export const api = {
  // null = el servidor dijo 304 (nada cambió desde la última vez).
  bootstrap: (): Promise<Bootstrap | null> => {
    if (bootstrapEnVuelo) return bootstrapEnVuelo;
    bootstrapEnVuelo = (async () => {
      const res = await fetch("/api/bootstrap", {
        headers: etagBootstrap ? { "If-None-Match": etagBootstrap } : undefined,
      });
      if (res.status === 304) return null;
      const etag = res.headers.get("ETag");
      const data = (await jsonOrThrow(res)) as Bootstrap;
      // El ETag se guarda DESPUÉS de tener los datos en mano: si el parseo falla,
      // no queremos quedar diciendo "ya la tengo" sin tenerla.
      if (etag) etagBootstrap = etag;
      return data;
    })().finally(() => { bootstrapEnVuelo = null; });
    return bootstrapEnVuelo;
  },

  createPedido: (body: unknown): Promise<{ idPedidoCompra: number }> =>
    fetch("/api/pedidos", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }).then(jsonOrThrow),
  getPedido: (id: string): Promise<Pedido> => fetch(`/api/pedidos/${id}`).then(jsonOrThrow),
  patchPedidoEstado: (id: string, body: unknown) =>
    fetch(`/api/pedidos/${id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }).then(jsonOrThrow),
  // Devolver LÍNEAS de una solicitud al ingeniero (o todas: el server decide si el
  // pedido entero queda "Devuelto").
  devolverLineasPedido: (id: string, body: unknown): Promise<{ devueltas: number; pedidoDevuelto: boolean; nombres: string[] }> =>
    fetch(`/api/pedidos/${id}/devolver`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }).then(jsonOrThrow),
  putPedido: (id: string, body: unknown) =>
    fetch(`/api/pedidos/${id}`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }).then(jsonOrThrow),
  deletePedido: (id: string, body: unknown) =>
    fetch(`/api/pedidos/${id}`, { method: "DELETE", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }).then(jsonOrThrow),

  // Devolver al ingeniero LÍNEAS que ya están dentro de una orden Abierta/Rechazada:
  // salen de la orden (el saldo vuelve a la solicitud) y quedan marcadas devueltas.
  devolverLineasOrden: (id: string, body: unknown): Promise<{ ordenNo: string; devueltas: number; nombres: string[]; ordenDescartada: boolean; bcAviso?: string }> =>
    fetch(`/api/ordenes/${id}/devolver-lineas`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }).then(jsonOrThrow),

  createOrden: (body: unknown): Promise<{ idOrdenCompra: number }> =>
    fetch("/api/ordenes", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }).then(jsonOrThrow),
  getOrden: (id: string): Promise<Orden> => fetch(`/api/ordenes/${id}`).then(jsonOrThrow),
  patchOrdenEstado: (id: string, body: unknown) =>
    fetch(`/api/ordenes/${id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }).then(jsonOrThrow),
  // Re-apuntar la orden a otro pedido de BC (allá un pedido se "corrige" borrándolo
  // y creando otro, y la orden se queda hablando con un número que ya no existe).
  corregirBcNumber: (id: string, body: unknown): Promise<{ bcAviso?: string }> =>
    fetch(`/api/ordenes/${id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }).then(jsonOrThrow),
  cerrarOrden: (id: string, body: unknown) =>
    fetch(`/api/ordenes/${id}/cerrar`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }).then(jsonOrThrow),
  nuevaOrdenConPendiente: (id: string, body: unknown) =>
    fetch(`/api/ordenes/${id}/nueva-con-pendiente`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }).then(jsonOrThrow),
  // Descartar un borrador de orden (vuelve el saldo a la solicitud).
  descartarOrden: (id: string, body: unknown): Promise<{ numero: string; saldoDevuelto: number }> =>
    fetch(`/api/ordenes/${id}`, { method: "DELETE", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }).then(jsonOrThrow),
  updateOrden: (id: string, body: unknown) =>
    fetch(`/api/ordenes/${id}`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }).then(jsonOrThrow),

  createRecepcion: (body: unknown): Promise<{ idRecepcionCompra: number }> =>
    fetch("/api/recepciones", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }).then(jsonOrThrow),

  // Foto(s) de la factura física de una recepción ya registrada. Van aparte del
  // POST de la recepción a propósito: ese request ya carga con BC + SQL y una
  // foto que falle no debe tumbar el registro del material.
  addFotosRecepcion: (id: string, body: unknown): Promise<{ guardadas: number }> =>
    fetch(`/api/recepciones/${id}/foto`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }).then(jsonOrThrow),

  // MODO 2: registrar la factura de una recepción que estaba en revisión.
  setRecepcionFactura: (id: string, body: unknown): Promise<{ ok: true }> =>
    fetch(`/api/recepciones/${id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }).then(jsonOrThrow),

  // Notas de crédito (líneas de factura con problema, para emitir NC).
  createNotasCredito: (body: unknown): Promise<{ ok: true }> =>
    fetch("/api/notas-credito", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }).then(jsonOrThrow),
  setNotaCreditoEstado: (id: string, body: unknown): Promise<{ ok: true }> =>
    fetch(`/api/notas-credito/${id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }).then(jsonOrThrow),
  listNotasCredito: (): Promise<NotaCreditoLinea[]> =>
    fetch("/api/notas-credito").then(jsonOrThrow).then((d) => (d.notas ?? []) as NotaCreditoLinea[]),
};
