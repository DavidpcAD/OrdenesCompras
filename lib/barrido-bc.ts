/* ============================================================================
   EL BARRIDO: las facturas que BC registró y la app no tiene.

   De dónde sale. El 30 de setiembre de 2026 se cruzó, a mano, el bootstrap de la
   app contra las 4.744 facturas de compra que BC registró en 2026. Aparecieron
   **70 órdenes con factura registrada en BC y CERO recepciones acá**, ₡41,4
   millones, y una más con una factura de menos (CP-005138). Ninguna había dado
   una alarma: la app las seguía mostrando "Lanzado · recibido 0%", o sea
   pendientes de que llegara el material que ya había llegado, ya se había
   facturado y ya estaba en la contabilidad.

   Por qué no lo encontraba Conciliación BC. Esa pantalla pregunta pedido por
   pedido (una o dos llamadas a BC por orden), así que barrer las 657 órdenes que
   viven en BC toma tandas y minutos, y nadie lo corre completo. Este barrido hace
   la pregunta al revés —"BC, dame TODO lo que registraste desde tal fecha"— y
   cruza acá. Es una consulta y segundos.

   Y una distinción que importa más que el hallazgo (la trae `usuario`):
   - `BUSINESSCENTRAL_API_ADELANTE` = posteó ESTA app y no alcanzó a guardar acá.
     Es el bug del doble viaje, tapado el 10 de setiembre de 2026 (guardado en la
     misma llamada, lib/guardado-tras-bc.ts). Pegó UNA vez: CP-005394.
   - una persona (KATTYA, BRENDA, JESSIE, ALMACEN3…) = la factura se registró a
     mano en BC, sin pasar por Bodega en la app. Eso no es un bug, es el proceso,
     y es lo que explica 70 de los 71 casos. Sigue pasando.

   Todo acá es PURO (sin red, sin SQL) para poder probarlo: ver barrido-bc.test.ts.
   ============================================================================ */

/** El usuario con el que ESTA app postea en BC. Si una factura lleva su nombre, la
 *  posteó la integración y no una persona. Lo lee `lib/bc.ts` al leer BC. */
export const USUARIO_INTEGRACION = "BUSINESSCENTRAL_API_ADELANTE";

/** Una factura de compra REGISTRADA en BC, como la devuelve `bcFacturasRegistradasDelPeriodo`. */
export type FacturaBcPeriodo = {
  numero: string;           // CFR-010109
  pedido: string;           // CP-005394 (Order No.)
  fecha: string;            // ISO corto
  vendorNo: string;
  vendorName: string;
  facturaProveedor: string; // el N.º que trae el papel
  total: number;            // con IVA
  currencyCode: string;
  estado: string;           // Open | Paid | Canceled | Corrective
};

export type OrdenBarrido = {
  id: string;
  numero: string;
  bcNumber?: string;
  fecha: string;
  estado: string;
  currencyCode?: string;
  proveedorNombre?: string;
  proveedorNo?: string;
  proveedorId?: string;
};

export type RecepcionBarrido = {
  ordenId: string;
  numeroFactura?: string;
  bcFacturaNo?: string;
};

export type FacturaFaltante = FacturaBcPeriodo & {
  usuario: string;       // quién la registró en BC ("" si no se pudo leer)
  laPosteoLaApp: boolean;
};

export type FilaBarrido = {
  id: string; numero: string; bcNumber: string; fecha: string;
  proveedor: string; estadoOrden: string; moneda: string;
  recepcionesApp: number;
  faltantes: FacturaFaltante[];
  importe: number;                       // suma de las faltantes, con IVA
  clase: "app" | "persona" | "mixto";    // quién registró las que faltan
};

/** Normaliza un N.º de factura para compararlo: mayúsculas, sin espacios ni ceros al frente. */
export function claveFactura(v: string | undefined | null): string {
  const s = String(v ?? "").trim().toUpperCase().replace(/\s+/g, "");
  return s.replace(/^0+(?=.)/, "");
}

/** Las facturas de BC que no se anularon, agrupadas por N.º de pedido. */
export function agruparPorPedido(facturas: FacturaBcPeriodo[]): Map<string, FacturaBcPeriodo[]> {
  const m = new Map<string, FacturaBcPeriodo[]>();
  for (const f of facturas) {
    // Una factura anulada en BC no es material que falte registrar acá: es una que
    // allá ya se deshizo. Contarla haría que el barrido pida guardar un movimiento
    // que no existe.
    if (/^cancel/i.test(f.estado)) continue;
    const k = (f.pedido ?? "").trim();
    if (!k) continue;
    const l = m.get(k);
    if (l) l.push(f); else m.set(k, [f]);
  }
  return m;
}

/**
 * EL CRUCE. Por cada orden de la app que vive en BC, mira qué facturas tiene BC
 * contra ese pedido y cuáles de esas ya están guardadas acá.
 *
 * Una factura de BC cuenta como "ya está en la app" si alguna recepción la nombra,
 * y se acepta por CUALQUIERA de los dos números: el documento de BC (`bcFacturaNo`,
 * CFR-…) o el del proveedor (`numeroFactura`, el del papel). Los dos, porque:
 *   - las recepciones viejas no tienen `bcFacturaNo` (la columna se agregó después), y
 *   - las conciliadas a mano tampoco lo traen.
 * Con un solo criterio, esas saldrían como faltantes y el barrido acusaría en falso.
 */
export function cruzarFacturasDeBc(
  ordenes: OrdenBarrido[],
  recepciones: RecepcionBarrido[],
  facturas: FacturaBcPeriodo[],
  quienRegistro: Record<string, string> = {},
): FilaBarrido[] {
  const porPedido = agruparPorPedido(facturas);
  const porOrden = new Map<string, RecepcionBarrido[]>();
  for (const r of recepciones) {
    const l = porOrden.get(r.ordenId);
    if (l) l.push(r); else porOrden.set(r.ordenId, [r]);
  }

  const filas: FilaBarrido[] = [];
  for (const o of ordenes) {
    const bc = (o.bcNumber ?? "").trim();
    if (!bc) continue;
    const enBc = porPedido.get(bc);
    if (!enBc?.length) continue;

    const rs = porOrden.get(o.id) ?? [];
    const yaEstan = new Set<string>();
    for (const r of rs) {
      const a = claveFactura(r.bcFacturaNo); if (a) yaEstan.add(a);
      const b = claveFactura(r.numeroFactura); if (b) yaEstan.add(b);
    }

    const faltantes: FacturaFaltante[] = enBc
      .filter((f) => !yaEstan.has(claveFactura(f.numero)) && !yaEstan.has(claveFactura(f.facturaProveedor)))
      .map((f) => {
        const usuario = (quienRegistro[f.numero] ?? "").trim();
        return { ...f, usuario, laPosteoLaApp: usuario.toUpperCase() === USUARIO_INTEGRACION };
      });
    if (!faltantes.length) continue;

    const app = faltantes.some((f) => f.laPosteoLaApp);
    const persona = faltantes.some((f) => !f.laPosteoLaApp);
    filas.push({
      id: o.id, numero: o.numero, bcNumber: bc, fecha: o.fecha,
      proveedor: o.proveedorNombre || o.proveedorNo || o.proveedorId || "",
      estadoOrden: o.estado, moneda: o.currencyCode || "CRC",
      recepcionesApp: rs.length,
      faltantes,
      importe: faltantes.reduce((s, f) => s + f.total, 0),
      clase: app && persona ? "mixto" : app ? "app" : "persona",
    });
  }
  // Lo más nuevo primero: si algo se rompió ayer, se ve sin bajar la página.
  return filas.sort((a, b) => (b.fecha ?? "").localeCompare(a.fecha ?? ""));
}

export type ResumenBarrido = {
  ordenes: number;          // órdenes de la app con desfase
  facturas: number;         // facturas de BC que faltan acá
  importe: number;
  deLaApp: number;          // las que posteó la integración (el bug)
  dePersona: number;        // las que alguien registró a mano en BC
};

export function resumirBarrido(filas: FilaBarrido[]): ResumenBarrido {
  const todas = filas.flatMap((f) => f.faltantes);
  return {
    ordenes: filas.length,
    facturas: todas.length,
    importe: todas.reduce((s, f) => s + f.total, 0),
    deLaApp: todas.filter((f) => f.laPosteoLaApp).length,
    dePersona: todas.filter((f) => !f.laPosteoLaApp).length,
  };
}
