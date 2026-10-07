// Cliente del front-end para las API routes (modo API).
import type { Orden, Pedido, Recepcion, NotaCreditoLinea } from "./types.ts";
import { LOTE_DEFECTO } from "./lotes.ts";

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

// ETag del último bootstrap recibido: el servidor contesta 304 si nada cambió, y el
// poll de 45 s deja de BAJAR todas las órdenes y líneas cada vez.
// OJO con lo que el 304 ahorra y lo que no: el servidor arma el payload completo
// igual (consulta SQL + huella) y recién ahí compara, así que lo que se ahorra es el
// viaje y el parseo en el cliente, no el trabajo de la base. Es a propósito: la huella
// se saca de lo que REALMENTE se iba a mandar, y cualquier atajo más barato se
// arriesga a no ver un cambio y dejar la pantalla vieja creyéndose al día.
let etagBootstrap: string | null = null;
// La caché del navegador (lib/cache-bootstrap.ts) guarda el ETag junto con el cuerpo:
// al abrir la app se lo devuelve acá para que el primer viaje ya pueda contestar 304.
export const setEtagBootstrap = (e: string | null) => { etagBootstrap = e; };
// Un solo bootstrap a la vez: el refresco se dispara por varias vías (poll, volver
// a la pestaña, cambiar de pantalla) y dos llegando juntos hacían el mismo trabajo
// de SQL dos veces.
let bootstrapEnVuelo: Promise<BootstrapFresco | null> | null = null;

// Lo que devuelve un bootstrap que SÍ trajo datos: los datos ya parseados, el texto
// tal cual vino (para guardarlo sin volver a serializar) y su ETag.
export type BootstrapFresco = { datos: Bootstrap; texto: string; etag: string | null };

// ── CARGA POR LOTES ──────────────────────────────────────────────────────────
// Un lote es "los N más nuevos de cada cosa, por debajo de estos cursores". El
// cliente pinta el primero y sigue pidiendo hacia atrás hasta `completo`. No lleva
// ETag a propósito: el ETag es la huella de la historia COMPLETA y la usa el
// refresco de 45 s; un pedazo no puede hacerse pasar por la foto entera.
export type CursoresLote = { pedidos: number | null; ordenes: number | null; recepciones: number | null };
export type LoteBootstrap = {
  pedidos: Pedido[];
  ordenes: Orden[];
  recepciones: Recepcion[];
  notas: NotaCreditoLinea[];
  cursores: CursoresLote;
  completo: boolean;
  // Solo en el primer lote: cuántos hay en total, para poder decir "600 de 787".
  totales: { pedidos: number; ordenes: number; recepciones: number } | null;
};

// El tamaño de la tanda sale de lib/lotes.ts, que es de donde lo lee el servidor:
// dos constantes separadas se desincronizan el día que alguien toca una sola.

export const api = {
  // null = el servidor dijo 304 (nada cambió desde la última vez).
  bootstrap: (): Promise<BootstrapFresco | null> => {
    if (bootstrapEnVuelo) return bootstrapEnVuelo;
    bootstrapEnVuelo = (async () => {
      const res = await fetch("/api/bootstrap", {
        headers: etagBootstrap ? { "If-None-Match": etagBootstrap } : undefined,
      });
      if (res.status === 304) return null;
      if (!res.ok) await jsonOrThrow(res);   // lanza con el mensaje del server
      const etag = res.headers.get("ETag");
      // Se lee como TEXTO y se parsea acá: ese mismo texto es el que se guarda en la
      // caché del navegador, así no hay que volver a serializar 1,2 MB para guardarlo.
      const texto = await res.text();
      const datos = JSON.parse(texto) as Bootstrap;
      // El ETag se guarda DESPUÉS de tener los datos en mano: si el parseo falla,
      // no queremos quedar diciendo "ya la tengo" sin tenerla.
      if (etag) etagBootstrap = etag;
      return { datos, texto, etag };
    })().finally(() => { bootstrapEnVuelo = null; });
    return bootstrapEnVuelo;
  },

  // Un lote de la carga inicial. `cursores` en null = el primero (trae además las
  // notas de crédito y los totales).
  bootstrapLote: (cursores: CursoresLote | null): Promise<LoteBootstrap> => {
    const q = new URLSearchParams({ n: String(LOTE_DEFECTO) });
    if (cursores) {
      if (cursores.pedidos != null) q.set("pc", String(cursores.pedidos));
      if (cursores.ordenes != null) q.set("oc", String(cursores.ordenes));
      if (cursores.recepciones != null) q.set("rc", String(cursores.recepciones));
    }
    return fetch(`/api/bootstrap?${q}`).then(jsonOrThrow);
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
  // Archivar una solicitud que quedó a medias (el motivo es obligatorio del lado del
  // server) y deshacer ese archivado.
  cerrarSolicitud: (id: string, body: unknown): Promise<{ numero: string; lineasCanceladas: number; unidadesCanceladas: number; lineasOrdenadas: number }> =>
    fetch(`/api/pedidos/${id}/cerrar`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }).then(jsonOrThrow),
  reabrirSolicitud: (id: string, body: unknown): Promise<{ numero: string; estado: string }> =>
    fetch(`/api/pedidos/${id}/cerrar`, { method: "DELETE", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }).then(jsonOrThrow),
  putPedido: (id: string, body: unknown) =>
    fetch(`/api/pedidos/${id}`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }).then(jsonOrThrow),
  deletePedido: (id: string, body: unknown) =>
    fetch(`/api/pedidos/${id}`, { method: "DELETE", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }).then(jsonOrThrow),

  // Copiar a la orden el IVA que BC va a contabilizar (el de la app es solo estimado).
  alinearIvaConBc: (id: string, body: unknown): Promise<{ ordenNo: string; cambiadas: number; detalle: string[] }> =>
    fetch(`/api/ordenes/${id}/iva-bc`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }).then(jsonOrThrow),

  // Al revés que la anterior: quitarle el IVA al pedido EN BC (una importación paga el
  // impuesto en aduana) y después dejar la orden con lo que BC quedó calculando.
  exonerarIvaEnBc: (id: string, body: unknown): Promise<{
    ordenNo: string; grupo: string; cambiadas: string[]; yaEstaban: string[]; fallas: string[];
    ivaAntes: number; ivaDespues: number; totalDespues: number; moneda: string;
    // El pedido estaba lanzado en BC: hubo que des-lanzarlo y volver a lanzarlo.
    reabierto: boolean; relanzado: boolean;
    alineadas: number; aviso?: string;
  }> =>
    fetch(`/api/ordenes/${id}/iva-bc`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }).then(jsonOrThrow),

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
  // Marcar/desmarcar a mano que la orden ya se le mandó al proveedor (la automática
  // la pone la descarga del PDF).
  marcarEnviadaProveedor: (id: string, enviada: boolean, body: unknown) =>
    fetch(`/api/ordenes/${id}/enviada`, { method: enviada ? "POST" : "DELETE", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }).then(jsonOrThrow),
  cerrarOrden: (id: string, body: unknown) =>
    fetch(`/api/ordenes/${id}/cerrar`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }).then(jsonOrThrow),
  nuevaOrdenConPendiente: (id: string, body: unknown) =>
    fetch(`/api/ordenes/${id}/nueva-con-pendiente`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }).then(jsonOrThrow),
  // Retomar la orden que se había descartado al devolver todo su material (su pedido
  // sigue en BC): devuelve su id para poder abrirla.
  retomarOrden: (body: unknown): Promise<{ id: number; ordenNo: string; bcNo: string; yaEstaba: boolean; bcAviso?: string }> =>
    fetch(`/api/ordenes/retomar`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }).then(jsonOrThrow),
  // Descartar un borrador de orden (vuelve el saldo a la solicitud).
  descartarOrden: (id: string, body: unknown): Promise<{ numero: string; saldoDevuelto: number; bcBaja?: string }> =>
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
