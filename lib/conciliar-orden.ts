/* ============================================================================
   CONCILIAR UNA ORDEN QUE BC YA FACTURÓ Y LA APP NO SE ENTERÓ.

   El caso: una persona registró la factura a mano en Business Central, por fuera
   de la app (ver lib/barrido-bc.ts). La orden se queda "Lanzada · recibido 0%"
   para siempre: Proveeduría la ve pendiente de un material que ya llegó, ya se
   facturó y ya está en la contabilidad. El barrido las encuentra; esto las pone
   al día de un clic, guardando la recepción EN LA APP —sin volver a registrar nada
   en BC— apuntando a la factura que allá ya existe.

   La regla de oro es la misma de todo el cotejo (lib/chequeo-orden.ts): no se
   SUPONE lo que BC tiene. El servidor lee BC, y este módulo —puro, probado— decide
   si el caso es lo bastante limpio para conciliar automático, o si hay que mandarlo
   al flujo manual de Facturación. Conciliar escribe que el material entró: si eso
   no es cierto en BC, deja la app mintiendo. Por eso sólo dice que sí cuando:

     1. BC tiene al menos una factura VIVA (no anulada) contra este pedido;
     2. esa factura está a nombre del MISMO proveedor de la orden;
     3. la orden todavía NO tiene ninguna recepción acá (el caso completo y limpio);
     4. las líneas de la orden coinciden con lo que BC facturó.

   Cualquier otra cosa —factura anulada, de otro proveedor, recepción parcial ya
   hecha, líneas que no cuadran— devuelve un motivo y se resuelve a mano. No se
   adivina.
   ============================================================================ */
import { cotejarLineas, type LineaApp, type LineaBc } from "./bc-conciliacion.ts";

/** Una factura registrada en BC contra el pedido, con lo que importa para decidir. */
export type FacturaConcilia = {
  numero: string;           // CFR-010199 (Document No. de BC)
  facturaProveedor: string; // el N.º del papel (vendorInvoiceNumber)
  vendorNo: string;         // a nombre de quién quedó
  total: number;            // con IVA
  currencyCode: string;
  fecha: string;            // ISO corto (posting date)
  status: string;           // Open | Paid | Canceled | …
};

/** La orden de la app, reducida a lo que la decisión necesita. */
export type OrdenConcilia = {
  id: string;
  bcNumber?: string;
  proveedorNo?: string;
  proveedorId?: string;
  lineas: {
    id: string;
    tipo: "articulo" | "recurso" | "activo_fijo" | "cargo";
    articuloId?: string;
    variantCode?: string;
    descripcion: string;
    cantidad: number;
    cantidadRecibida: number;
    precioUnitario: number;
    unidad: string;
  }[];
};

/** Lo que hay que guardar si se puede conciliar (lo arma el servidor en createRecepcion). */
export type PlanConciliacion = {
  lineas: { idOrdenCompraDet: number; cantidadRecibida: number }[];
  total: number;            // con IVA, suma de las facturas vivas
  numeroFactura: string;    // N.º del papel del proveedor (para el guard de duplicados)
  bcFacturaNo: string;      // el/los Document No. de BC (CFR-…), para el link y el barrido
  fechaFactura: string;     // la fecha de registro de la factura en BC
  nota: string;             // la línea de bitácora que explica que se conció
  facturas: string[];       // los CFR, para el mensaje de vuelta
};

export type ResultadoConciliacion =
  | { ok: true; plan: PlanConciliacion }
  | { ok: false; motivo: string };

const esAnulada = (s: string): boolean => /^cancel/i.test(String(s ?? "").trim());

export function decidirConciliacion(
  orden: OrdenConcilia,
  facturasBc: FacturaConcilia[],
  lineasBc: LineaBc[],
): ResultadoConciliacion {
  if (!orden.bcNumber) {
    return { ok: false, motivo: "La orden todavía no tiene pedido en Business Central." };
  }
  const proveedor = String(orden.proveedorNo || orden.proveedorId || "").trim();

  // 1) ¿Hay factura VIVA? Una anulada no es material que falte recibir: es una que
  //    allá ya se deshizo (CP-005380 / CFR-010133). Conciliarla inventaría una
  //    recepción de algo que en BC no quedó.
  const vivas = facturasBc.filter((f) => !esAnulada(f.status));
  if (!vivas.length) {
    return {
      ok: false,
      motivo: facturasBc.length
        ? `La factura de este pedido está anulada en Business Central (${facturasBc.map((f) => f.numero).filter(Boolean).join(", ")}): no hay recepción que poner al día. Si el pedido se re-hizo, cerrá esta orden como duplicada.`
        : "Business Central no tiene ninguna factura registrada contra este pedido.",
    };
  }

  // 2) EL PROVEEDOR MANDA. Que las líneas cuadren no vale nada si la factura quedó
  //    cargada a la cuenta por pagar de otro proveedor; eso ya no se arregla acá,
  //    necesita una nota de crédito (el caso CFR-009891 / CP-005289).
  const ajenas = [...new Set(
    vivas.filter((f) => f.vendorNo && proveedor && f.vendorNo !== proveedor).map((f) => f.vendorNo),
  )];
  if (ajenas.length) {
    return {
      ok: false,
      motivo: `La factura en Business Central está a nombre de otro proveedor (${ajenas.join(", ")}), no de ${proveedor}. Eso se corrige con una nota de crédito, no conciliando acá.`,
    };
  }

  // 3) La orden tiene que estar SIN recibir. La conciliación automática es para el
  //    caso completo y limpio; una orden con recepción parcial se pone al día a mano
  //    en Facturación para no duplicar lo ya recibido.
  const yaRecibido = orden.lineas.some((l) => Number(l.cantidadRecibida) > 1e-6);
  if (yaRecibido) {
    return { ok: false, motivo: "La orden ya tiene una recepción registrada en la app; ponela al día desde Facturación para no duplicar." };
  }

  // 4) Las líneas de la orden (completas) tienen que coincidir con lo que BC facturó.
  const docsVivos = new Set(vivas.map((f) => f.numero));
  const bcDeVivas = lineasBc.filter((l) => docsVivos.has(l.documentNo));
  if (!bcDeVivas.length) {
    return { ok: false, motivo: "No se pudieron leer en Business Central las líneas de la factura; ponela al día desde Facturación." };
  }
  const noCargo = orden.lineas.filter((l) => l.tipo !== "cargo");
  const appLineas: LineaApp[] = noCargo.map((l) => ({
    id: l.id,
    tipo: l.tipo,
    itemNo: String(l.articuloId ?? ""),
    variantCode: String(l.variantCode ?? ""),
    descripcion: l.descripcion,
    cantidad: Number(l.cantidad) || 0,
    precioUnitario: Number(l.precioUnitario) || 0,
    unidad: l.unidad,
  }));
  const cotejo = cotejarLineas(appLineas, bcDeVivas, { ignorarVariante: false });
  if (!cotejo.ok) {
    return { ok: false, motivo: `Las líneas de la orden no coinciden con lo que Business Central facturó: ${cotejo.resumen} Ponela al día desde Facturación.` };
  }

  // Todo cuadra: recibir COMPLETAS todas las líneas que no son cargo.
  const recibir = noCargo
    .map((l) => ({ idOrdenCompraDet: Number(l.id), cantidadRecibida: Number(l.cantidad) || 0 }))
    .filter((l) => Number.isFinite(l.idOrdenCompraDet) && l.idOrdenCompraDet > 0 && l.cantidadRecibida > 1e-6);
  if (!recibir.length) {
    return { ok: false, motivo: "La orden no tiene líneas por recibir." };
  }

  const facturas = vivas.map((f) => f.numero).filter(Boolean);
  const papeles = [...new Set(vivas.map((f) => f.facturaProveedor.trim()).filter(Boolean))];
  // El guard de duplicados de createRecepcion compara por numeroFactura (el papel);
  // con un solo documento es el del papel, con varios se unen para que siga siendo
  // único y el barrido reconozca la orden como ya puesta al día.
  const numeroFactura = (papeles.length ? papeles : facturas).join(", ").slice(0, 40);
  const total = vivas.reduce((s, f) => s + (Number(f.total) || 0), 0);
  const fechaFactura = vivas.map((f) => f.fecha).filter(Boolean).sort()[0] || "";
  const nota = `Conciliada con Business Central: ${facturas.length === 1 ? "la factura" : "las facturas"} ${facturas.join(", ")} ya estaba${facturas.length === 1 ? "" : "n"} registrada${facturas.length === 1 ? "" : "s"} allá (a mano, por fuera de la app). La recepción se guardó acá SIN volver a registrarla en BC.`;

  return {
    ok: true,
    plan: { lineas: recibir, total, numeroFactura, bcFacturaNo: facturas.join(", ").slice(0, 50), fechaFactura, nota, facturas },
  };
}
