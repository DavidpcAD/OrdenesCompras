import type { Orden } from "./types";
import { ordenLineaImporte } from "./helpers";
import { documentoDeOrden, destinoLineaDoc, fmtDoc, etiquetaUnidad } from "./orden-doc";
import { etiquetaVariante, nombreDeVariante, descripcionParaDocumento } from "./variantes.ts";
import {
  nuevoDocumento, dibujante, encabezadoMarca, bloqueEmpresa, numerarPaginas, formatearFecha,
  A4, MARGEN, DERECHA, ANCHO_UTIL, Y_CONTINUACION, NEGRO,
} from "./pdf-base";

// PDF de la orden de compra que se le manda al proveedor, dibujado en el SERVIDOR con
// pdfkit. Existe para que "Descargar PDF" baje un .pdf de una vez, sin pasar por el
// diálogo de impresión del navegador.
//
// Sin Chromium a propósito: en el App Service no hay, y arrastrar un navegador
// headless para un documento de una página no se paga. Los NÚMEROS no se recalculan
// acá: salen de `documentoDeOrden`, el mismo que usa la pantalla, así que el PDF y la
// vista nunca pueden decir totales distintos.
//
// Tipografía: Helvetica (las 14 estándar del PDF, sin archivos de fuente). Los montos
// van con el CÓDIGO de moneda ("Total CRC sin IVA"), nunca con el símbolo ₡: ese
// carácter no existe en la codificación de las fuentes estándar y saldría en blanco.

// Columnas de la tabla de líneas: x de inicio y ancho. Suman el ancho útil (515).
const COLS = {
  destino: { x: MARGEN, w: 62 },
  desc: { x: MARGEN + 66, w: 175 },
  cant: { x: MARGEN + 245, w: 42 },
  unidad: { x: MARGEN + 291, w: 46 },
  precio: { x: MARGEN + 341, w: 66 },
  desc_pct: { x: MARGEN + 411, w: 40 },
  importe: { x: MARGEN + 455, w: 60 },
};

// `variantes` = "ITEM|CODE" -> nombre de la variante en BC. Va impreso bajo la
// descripción por lo mismo que en la cotización: el material de BC es genérico y lo
// que el proveedor tiene que despachar (el grado, la medida, la talla) es la variante.
export function ordenAPdf(orden: Orden, unidades: Record<string, string> = {}, variantes: Record<string, string> = {}): Promise<Buffer> {
  const d = documentoDeOrden(orden, unidades);
  const { doc, listo } = nuevoDocumento(`${d.numeroDoc} · Orden de compra`);
  const { txt, regla } = dibujante(doc);

  encabezadoMarca(doc, txt, "Orden de compra");

  // ─────────────────────────────────────── dos columnas: proveedor / empresa
  let y = MARGEN + 56;
  const yCols = y;
  txt(orden.proveedorNombre ?? "—", MARGEN, y, { size: 10, bold: true, width: 250 });
  y += 16;
  const campo = (k: string, v: string, bold = false) => {
    txt(k, MARGEN, y, { size: 8 });
    txt(v, MARGEN + 118, y, { size: 8, bold, width: 140 });
    y += 12;
  };
  campo("Compra a-Nº proveedor", orden.proveedorNo ?? "—");
  y += 8;
  campo("Nº orden de compra", d.numeroDoc, true);
  campo("Fecha emisión documento", formatearFecha(orden.fecha));
  campo("Moneda", d.moneda);
  y += 8;
  campo("Almacén entrega", d.almacenUnico ?? "Varios (ver detalle)");

  const yd = bloqueEmpresa(txt, yCols);

  // ────────────────────────────────────────────────── tabla de líneas
  y = Math.max(y, yd) + 22;
  const cabecera = () => {
    regla(y, 1.2);
    y += 5;
    txt("Almacén /", COLS.destino.x, y, { size: 7.5, bold: true });
    txt("Obra", COLS.destino.x, y + 9, { size: 7.5, bold: true });
    txt("Descripción", COLS.desc.x, y + 9, { size: 7.5, bold: true });
    txt("Cant.", COLS.cant.x, y + 9, { size: 7.5, bold: true, width: COLS.cant.w, align: "right" });
    txt("Unidad", COLS.unidad.x, y, { size: 7.5, bold: true, width: COLS.unidad.w, align: "right" });
    txt("medida", COLS.unidad.x, y + 9, { size: 7.5, bold: true, width: COLS.unidad.w, align: "right" });
    txt("Coste unit.", COLS.precio.x, y, { size: 7.5, bold: true, width: COLS.precio.w, align: "right" });
    txt("directo", COLS.precio.x, y + 9, { size: 7.5, bold: true, width: COLS.precio.w, align: "right" });
    txt("% Desc.", COLS.desc_pct.x, y + 9, { size: 7.5, bold: true, width: COLS.desc_pct.w, align: "right" });
    txt("Importe", COLS.importe.x, y + 9, { size: 7.5, bold: true, width: COLS.importe.w, align: "right" });
    y += 22;
    regla(y, 1.2);
    y += 6;
  };
  cabecera();

  for (const l of d.lineas) {
    const desc = descripcionParaDocumento(l.descripcion,
      etiquetaVariante(l.variantCode, nombreDeVariante(variantes, l.articuloId, l.variantCode)));
    // Alto de la fila = lo que ocupe la descripción con salto de línea.
    const alto = Math.max(12, doc.font("Helvetica").fontSize(8).heightOfString(desc, { width: COLS.desc.w }));
    // Si no cabe, hoja nueva y se repite la cabecera (una orden puede tener 40 líneas).
    if (y + alto + 30 > A4.alto - MARGEN) {
      doc.addPage();
      y = Y_CONTINUACION;
      cabecera();
    }
    const cargo = l.tipo === "cargo";
    txt(cargo ? "—" : (destinoLineaDoc(l) || "—"), COLS.destino.x, y, { size: 8, bold: !cargo });
    doc.font("Helvetica").fontSize(8).fillColor(NEGRO).text(desc, COLS.desc.x, y, { width: COLS.desc.w });
    // Cantidad sin decimales cuando es entera (1 ESTAÑON), con dos cuando no
    // (2,5 M3). Antes iba siempre a 0 decimales y 0,5 se imprimía como 1.
    txt(fmtDoc(l.cantidad, Number.isInteger(l.cantidad) ? 0 : 2), COLS.cant.x, y, { size: 8, width: COLS.cant.w, align: "right" });
    // La descripción de la unidad, como el reporte de BC ("ESTAÑON"). Si no cabe en
    // la columna se cae al código, que siempre entra.
    const etiqueta = etiquetaUnidad(l.unidad || "", d.unidades);
    const cabe = doc.font("Helvetica").fontSize(8).widthOfString(etiqueta) <= COLS.unidad.w;
    txt(cabe ? etiqueta : (l.unidad || ""), COLS.unidad.x, y, { size: 8, width: COLS.unidad.w, align: "right" });
    txt(fmtDoc(l.precioUnitario), COLS.precio.x, y, { size: 8, width: COLS.precio.w, align: "right" });
    txt((l.descuentoPct ?? 0) > 0 ? fmtDoc(l.descuentoPct!, 0) : "", COLS.desc_pct.x, y, { size: 8, width: COLS.desc_pct.w, align: "right" });
    txt(fmtDoc(ordenLineaImporte(l)), COLS.importe.x, y, { size: 8, width: COLS.importe.w, align: "right" });
    y += alto + 6;
    regla(y - 3, 0.5, "#dcdcdc");
  }

  // ─────────────────────────────────────────────────────── totales
  y += 14;
  const xTot = DERECHA - 250;
  const filaTotal = (k: string, v: string, opts: { top?: boolean; grande?: boolean } = {}) => {
    if (opts.top) { regla(y, 1.2, NEGRO, xTot, DERECHA); y += 5; }
    txt(k, xTot, y, { size: opts.grande ? 9.5 : 8.5, bold: !!opts.grande, width: 160 });
    txt(v, DERECHA - 110, y, { size: opts.grande ? 9.5 : 8.5, bold: !!opts.grande, width: 110, align: "right" });
    y += opts.grande ? 15 : 13;
  };
  filaTotal(`Total ${d.moneda} sin IVA`, fmtDoc(d.subtotal), { top: true });
  // Con más de una tasa en la orden, poner "13% IVA" sería falso.
  filaTotal(d.porTasaIva.length > 1 ? "IVA" : `${d.ivaPct}% IVA`, fmtDoc(d.iva));
  regla(y, 1.2, NEGRO, xTot, DERECHA);
  y += 4;
  filaTotal(`Total ${d.moneda} con IVA`, fmtDoc(d.total), { grande: true });
  regla(y - 2, 1.2, NEGRO, xTot, DERECHA);
  regla(y, 1.2, NEGRO, xTot, DERECHA);

  // ────────────────────────────────────── especificación del IVA (como BC)
  y += 24;
  if (y + 70 > A4.alto - MARGEN) { doc.addPage(); y = Y_CONTINUACION; }
  txt("Especificación importe IVA", MARGEN, y, { size: 9, bold: true });
  y += 14;
  const colsIva = [
    { k: "Identif. IVA", x: MARGEN, w: 90, align: "left" as const },
    { k: "% IVA", x: MARGEN + 95, w: 60, align: "right" as const },
    { k: "Importe línea", x: MARGEN + 160, w: 110, align: "right" as const },
    { k: "Base IVA", x: MARGEN + 275, w: 110, align: "right" as const },
    { k: "Importe IVA", x: MARGEN + 390, w: 125, align: "right" as const },
  ];
  for (const c of colsIva) txt(c.k, c.x, y, { size: 7.5, bold: true, width: c.w, align: c.align });
  y += 11;
  regla(y, 1.2);
  y += 5;
  for (const g of d.porTasaIva) {
    const vals = [`IVA${g.pct}`, String(g.pct), fmtDoc(g.base), fmtDoc(g.base), fmtDoc(g.iva)];
    colsIva.forEach((c, i) => txt(vals[i], c.x, y, { size: 8, width: c.w, align: c.align }));
    y += 12;
  }
  regla(y, 1.2);
  y += 5;
  const totIva = ["Total", "", fmtDoc(d.subtotal), fmtDoc(d.subtotal), fmtDoc(d.iva)];
  colsIva.forEach((c, i) => txt(totIva[i], c.x, y, { size: 8, bold: true, width: c.w, align: c.align }));
  y += 18;

  // ─────────────────────────────────────────────────── observaciones
  const obs = orden.observaciones?.trim();
  if (obs) {
    const alto = doc.font("Helvetica").fontSize(8).heightOfString(obs, { width: ANCHO_UTIL });
    if (y + alto + 30 > A4.alto - MARGEN) { doc.addPage(); y = Y_CONTINUACION; }
    regla(y, 1.2);
    y += 8;
    txt("Observaciones", MARGEN, y, { size: 9, bold: true });
    y += 13;
    doc.font("Helvetica").fontSize(8).fillColor(NEGRO).text(obs, MARGEN, y, { width: ANCHO_UTIL });
  }

  numerarPaginas(doc);
  doc.end();
  return listo;
}
