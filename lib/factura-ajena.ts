/* ============================================================================
   ¿LA FACTURA QUE BC DICE QUE "YA EXISTE" PRUEBA QUE ESTA RECEPCIÓN ENTRÓ?

   Cuando BC rechaza un registro con "Purchase Invoice 137564 already exists for
   this vendor", la app lo tomaba como prueba de que ESTA orden ya estaba
   registrada allá, y le ofrecía a Bodega guardar la recepción sin tocar BC. Eso
   vale cuando la factura repetida salió de este mismo pedido y sigue viva: el
   posteo entró y la app no se enteró (CP-005148, factura 586265). NO vale cuando
   el número lo usó OTRO pedido, ni cuando la factura se anuló.

   Caso real, 10 nov 2026: CP-006485 (DITESA) se registró como CFR-012069 con la
   factura 137564, y ese mismo día se anuló con la nota de crédito CNCR-000507.
   Proveeduría hizo la sustituta CP-006578 y, al recibirla con la misma factura,
   BC contestó "ya existe": BC no deja repetir el N.º de factura de un proveedor
   aunque la primera esté anulada. La app la dio por recibida, enlazada a
   CFR-012069. En la app quedó "Completa"; en BC el pedido siguió lanzado y sin
   recibir nada, y el material nunca entró al inventario.

   Las pistas son el `orderNumber` de la factura en BC y la nota de crédito que la
   corrige. El estado NO sirve: una factura anulada con nota de crédito correctiva
   queda "Paid", no "Canceled".

   Módulo puro (sin BC ni SQL) para poder probarlo: lo usan el diagnóstico de
   /api/bc/registrar, la pantalla de Bodega y el candado de POST /api/recepciones.
   ============================================================================ */

/**
 * De quién es la factura registrada en BC, comparada con el pedido que se quiere recibir.
 *  · esta-orden → salió de este pedido.
 *  · otra-orden → la registró otro pedido: esta orden NO está registrada.
 *  · sin-pedido → se registró suelta en BC, sin pedido: esta orden tampoco.
 *  · sin-dato   → no se pudo leer de qué pedido es: no se supone nada.
 */
export type DuenoFactura = "esta-orden" | "otra-orden" | "sin-pedido" | "sin-dato";

const normal = (s: unknown): string => String(s ?? "").trim().toUpperCase();

export function duenoDeLaFactura(pedidoDeLaFactura: string | null | undefined, orderNo: string): DuenoFactura {
  if (pedidoDeLaFactura === null || pedidoDeLaFactura === undefined) return "sin-dato";
  const mio = normal(orderNo);
  if (!mio) return "sin-dato";
  const suyo = normal(pedidoDeLaFactura);
  if (!suyo) return "sin-pedido";
  return suyo === mio ? "esta-orden" : "otra-orden";
}

/** Se SABE que la factura no es de esta orden (sin dato no cuenta). */
export function esFacturaAjena(dueno: DuenoFactura): boolean {
  return dueno === "otra-orden" || dueno === "sin-pedido";
}

/**
 * ¿La factura prueba que ESTA recepción ya está registrada en BC? Solo si salió de
 * este pedido y no se anuló. `anuladaCon` = N.º de la nota de crédito que la corrige.
 */
export function pruebaQueYaEntro(dueno: DuenoFactura, anuladaCon?: string | null): boolean {
  return dueno === "esta-orden" && !String(anuladaCon ?? "").trim();
}

/**
 * ¿Se sabe con certeza que NO sirve, y entonces conciliar sería mentir? (de otro
 * pedido, sin pedido, o anulada). Sin dato no se afirma ni una cosa ni la otra.
 */
export function facturaNoSirve(dueno: DuenoFactura, anuladaCon?: string | null): boolean {
  return esFacturaAjena(dueno) || !!String(anuladaCon ?? "").trim();
}

/**
 * Los CFR que guarda una recepción en `bcFacturaNo`: uno, o varios separados por
 * coma cuando una conciliación juntó más de una factura (ver conciliar-orden.ts).
 */
export function numerosDeFactura(bcFacturaNo: string | null | undefined): string[] {
  return String(bcFacturaNo ?? "")
    .split(/[,;\s]+/)
    .map((s) => s.trim())
    .filter(Boolean);
}

export type FacturaYaUsada = {
  facturaProveedor: string;  // el N.º del papel (137564)
  factura: string;           // el documento registrado en BC (CFR-012069)
  pedidoDeLaFactura: string; // de qué pedido salió ('' = sin pedido)
  anuladaCon?: string;       // la nota de crédito que la anuló, si se encontró
  orderNo: string;           // el pedido que se quiere recibir
};

/** Título del aviso: "en otro pedido" solo cuando es de otro pedido. */
export function tituloFacturaYaUsada(f: FacturaYaUsada): string {
  const papel = f.facturaProveedor ? `La factura ${f.facturaProveedor}` : "Esa factura";
  return duenoDeLaFactura(f.pedidoDeLaFactura, f.orderNo) === "esta-orden"
    ? `${papel} ya se usó en BC y está anulada`
    : `${papel} ya se usó en otro pedido`;
}

/** Qué pasó, con los números concretos. */
export function explicarFacturaYaUsada(f: FacturaYaUsada): string {
  const papel = f.facturaProveedor ? `La factura ${f.facturaProveedor}` : "Esa factura";
  const dueno = duenoDeLaFactura(f.pedidoDeLaFactura, f.orderNo);
  const deDonde = dueno === "esta-orden"
    ? "de este mismo pedido"
    : f.pedidoDeLaFactura
    ? `del pedido ${f.pedidoDeLaFactura}`
    : "sin pedido (se registró directo en BC)";
  const anulada = f.anuladaCon ? `, y se anuló con la nota de crédito ${f.anuladaCon}` : "";
  return `${papel} ya está registrada en Business Central como ${f.factura || "otra factura"}, ${deDonde}${anulada}. `
    + `BC no deja usar dos veces el mismo N.º de factura de un proveedor, aunque la primera esté anulada. `
    + `Esta recepción NO quedó registrada: el material todavía no entró en BC.`;
}

/** Qué hacer. Lo dicen igual la pantalla y el candado del servidor. */
export function queHacerConFacturaYaUsada(f: Pick<FacturaYaUsada, "facturaProveedor">): string {
  const ejemplo = f.facturaProveedor ? ` (por ejemplo ${f.facturaProveedor}-1)` : "";
  return `Pedile a Contabilidad con qué N.º se registra esta factura${ejemplo}, cambialo en "N.º de factura del proveedor" y volvé a registrar.`;
}
