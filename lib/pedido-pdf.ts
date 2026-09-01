import type { Pedido, PedidoLinea } from "./types";
import { lineasACotizar, observacionesParaProveedor, destinoCodigo, destinoLabel } from "./helpers";
import { etiquetaUnidad, fmtDoc } from "./orden-doc";
import { etiquetaVariante, nombreDeVariante, descripcionParaDocumento } from "./variantes.ts";
import {
  nuevoDocumento, dibujante, encabezadoMarca, bloqueEmpresa, numerarPaginas, formatearFecha,
  A4, MARGEN, DERECHA, ANCHO_UTIL, ANCHO_UTIL as UTIL, Y_CONTINUACION, GRIS, NEGRO,
} from "./pdf-base";

// SOLICITUD DE COTIZACIÓN: la solicitud de Ingeniería convertida en un documento que
// Proveeduría le manda a uno o varios proveedores para que le pongan precio.
//
// No es una orden de compra y no debe parecerlo: no lleva precios nuestros ni
// totales. Lleva las columnas de precio EN BLANCO para que el proveedor las llene,
// y al pie los datos que siempre hay que preguntar (validez, entrega, condiciones).
// Se dibuja con las mismas piezas que la orden (lib/pdf-base.ts) para que los dos
// documentos se vean de la misma casa.

// Columnas: suman el ancho útil (515). Sin columna de almacén a propósito — al
// proveedor no le importa a qué bodega entra, y ese espacio se le da a la
// descripción, que es donde está la medida que distingue una línea de otra
// ("CODO 45 PVC 1/2" vs "CODO 45 PVC 3/4").
const COLS = {
  cod: { x: MARGEN, w: 62 },
  desc: { x: MARGEN + 66, w: 205 },
  cant: { x: MARGEN + 275, w: 45 },
  unidad: { x: MARGEN + 324, w: 56 },
  precio: { x: MARGEN + 384, w: 60 },
  importe: { x: MARGEN + 448, w: 67 },
};

export function nombreArchivoPedido(pedido: Pedido): string {
  const num = (pedido.numero || "solicitud").replace(/[^\w.-]+/g, "-");
  return `${num}-solicitud-de-cotizacion.pdf`;
}

// `variantes` = "ITEM|CODE" -> nombre de la variante en BC (lo trae la ruta desde
// BC). El proveedor NO puede cotizar "PORCELANATO 60X60CM" ni "VARILLA DEFORME #3":
// el tipo y el grado están en la variante, así que van impresos bajo la descripción.
// Si BC no contestó, sale el código de variante; si la línea no tiene, no sale nada.
export function pedidoAPdf(pedido: Pedido, unidades: Record<string, string> = {}, variantes: Record<string, string> = {}): Promise<Buffer> {
  const { doc, listo } = nuevoDocumento(`${pedido.numero} · Solicitud de cotización`);
  const { txt, regla } = dibujante(doc);
  const filas = lineasACotizar(pedido);

  encabezadoMarca(doc, txt, "Solicitud de cotización");

  // ───────────────────────────── dos columnas: la solicitud / la empresa
  let y = MARGEN + 56;
  const yCols = y;
  txt("Proveedor", MARGEN, y, { size: 10, bold: true, width: 250 });
  // Línea en blanco: Angie manda el mismo documento a varios proveedores y escribe
  // (o dice por correo) a quién va. Poner un nombre acá obligaría a un PDF por cada uno.
  regla(y + 14, 0.8, "#c8c8c8", MARGEN + 62, MARGEN + 250);
  y += 24;
  const campo = (k: string, v: string, bold = false) => {
    txt(k, MARGEN, y, { size: 8 });
    txt(v, MARGEN + 118, y, { size: 8, bold, width: 140 });
    y += 12;
  };
  campo("Nº solicitud", pedido.numero || "—", true);
  campo("Fecha", formatearFecha(pedido.fecha));
  campo("Solicita", pedido.solicitante || "—");
  y += 8;
  campo("Destino", `${destinoCodigo(pedido)} · ${destinoLabel(pedido)}`);
  if (pedido.prioridad && pedido.prioridad !== "normal") campo("Prioridad", pedido.prioridad.toUpperCase(), true);

  const yd = bloqueEmpresa(txt, yCols);

  // ───────────────────────────────────────────────────── pedido al proveedor
  y = Math.max(y, yd) + 18;
  doc.font("Helvetica").fontSize(9).fillColor(NEGRO).text(
    "Le agradecemos cotizar los siguientes materiales. Puede llenar las columnas de precio de este mismo documento o responder por correo.",
    MARGEN, y, { width: ANCHO_UTIL });
  y += 26;

  // ───────────────────────────────────────────────────── tabla de materiales
  const cabecera = () => {
    regla(y, 1.2);
    y += 5;
    txt("Cód.", COLS.cod.x, y + 9, { size: 7.5, bold: true });
    txt("Descripción", COLS.desc.x, y + 9, { size: 7.5, bold: true });
    txt("Cantidad", COLS.cant.x, y + 9, { size: 7.5, bold: true, width: COLS.cant.w, align: "right" });
    txt("Unidad", COLS.unidad.x, y, { size: 7.5, bold: true, width: COLS.unidad.w, align: "right" });
    txt("medida", COLS.unidad.x, y + 9, { size: 7.5, bold: true, width: COLS.unidad.w, align: "right" });
    txt("Precio", COLS.precio.x, y, { size: 7.5, bold: true, width: COLS.precio.w, align: "right" });
    txt("unitario", COLS.precio.x, y + 9, { size: 7.5, bold: true, width: COLS.precio.w, align: "right" });
    txt("Importe", COLS.importe.x, y + 9, { size: 7.5, bold: true, width: COLS.importe.w, align: "right" });
    y += 22;
    regla(y, 1.2);
    y += 6;
  };
  cabecera();

  for (const { linea, cantidad } of filas) {
    // La descripción COMPLETA, con salto de línea: la medida del material suele
    // estar al final ("CODO 45 PVC PARED DELGADA 3/4"), así que cortarla deja el
    // documento inservible para cotizar.
    const desc = descripcionParaDocumento(linea.descripcion,
      etiquetaVariante(linea.variantCode, nombreDeVariante(variantes, linea.articuloId, linea.variantCode)));
    const cod = linea.articuloId || "";
    // El alto de la fila lo manda el que ocupe más: hay códigos con variante
    // ("M08-0123-VAR 02") que no caben en una línea y antes se le montaban encima
    // a la descripción.
    const altoDesc = doc.font("Helvetica").fontSize(8).heightOfString(desc, { width: COLS.desc.w });
    const altoCod = doc.font("Helvetica-Bold").fontSize(8).heightOfString(cod, { width: COLS.cod.w });
    const alto = Math.max(14, altoDesc, altoCod);
    if (y + alto + 30 > A4.alto - MARGEN) {
      doc.addPage();
      y = Y_CONTINUACION;
      cabecera();
    }
    doc.font("Helvetica-Bold").fontSize(8).fillColor(NEGRO).text(cod, COLS.cod.x, y, { width: COLS.cod.w });
    doc.font("Helvetica").fontSize(8).fillColor(NEGRO).text(desc, COLS.desc.x, y, { width: COLS.desc.w });
    txt(fmtDoc(cantidad, Number.isInteger(cantidad) ? 0 : 2), COLS.cant.x, y, { size: 8, width: COLS.cant.w, align: "right" });
    // La descripción de la unidad ("ESTAÑON"), como el reporte de BC; si no cabe en
    // la columna se cae al código.
    const etiqueta = etiquetaUnidad(linea.unidad || "", unidades);
    const cabe = doc.font("Helvetica").fontSize(8).widthOfString(etiqueta) <= COLS.unidad.w;
    txt(cabe ? etiqueta : (linea.unidad || ""), COLS.unidad.x, y, { size: 8, width: COLS.unidad.w, align: "right" });
    // Precio e importe EN BLANCO, con una raya para escribir a mano o en pantalla.
    regla(y + 9, 0.6, "#c8c8c8", COLS.precio.x, COLS.precio.x + COLS.precio.w);
    regla(y + 9, 0.6, "#c8c8c8", COLS.importe.x, COLS.importe.x + COLS.importe.w);
    y += alto + 6;
    regla(y - 3, 0.5, "#dcdcdc");
  }

  // ─────────────────────────────────────────── lo que hay que preguntar siempre
  y += 16;
  const alturaPie = 108;
  if (y + alturaPie > A4.alto - MARGEN) { doc.addPage(); y = Y_CONTINUACION; }
  txt("Total cotizado", DERECHA - 250, y, { size: 9, bold: true, width: 160 });
  regla(y + 11, 0.8, "#c8c8c8", DERECHA - 110, DERECHA);
  y += 26;

  regla(y, 1.2);
  y += 8;
  txt("Datos de la oferta", MARGEN, y, { size: 9, bold: true });
  y += 15;
  const aLlenar = (k: string, x: number, w: number) => {
    txt(k, x, y, { size: 8, color: GRIS });
    regla(y + 11, 0.8, "#c8c8c8", x, x + w);
  };
  aLlenar("Validez de la oferta", MARGEN, 150);
  aLlenar("Tiempo de entrega", MARGEN + 182, 150);
  aLlenar("Condiciones de pago", MARGEN + 364, UTIL - 364);
  y += 34;
  aLlenar("Nº de cotización del proveedor", MARGEN, 240);
  aLlenar("Fecha", MARGEN + 272, UTIL - 272);
  y += 30;

  // ─────────────────────────────────────────── comentario de la solicitud
  const notas = observacionesParaProveedor(pedido.notas);
  if (notas) {
    const alto = doc.font("Helvetica").fontSize(8).heightOfString(notas, { width: ANCHO_UTIL });
    if (y + alto + 30 > A4.alto - MARGEN) { doc.addPage(); y = Y_CONTINUACION; }
    regla(y, 1.2);
    y += 8;
    txt("Observaciones", MARGEN, y, { size: 9, bold: true });
    y += 13;
    doc.font("Helvetica").fontSize(8).fillColor(NEGRO).text(notas, MARGEN, y, { width: ANCHO_UTIL });
  }

  numerarPaginas(doc);
  doc.end();
  return listo;
}
