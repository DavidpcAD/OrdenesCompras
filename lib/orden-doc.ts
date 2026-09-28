import type { Orden, OrdenLinea } from "./types.ts";
import { esLineaCargo, esLineaRecibible, ordenIva, ordenLineaImporte, ordenSubtotal } from "./helpers.ts";

// Datos del DOCUMENTO de una orden (el que se le manda al proveedor), calculados una
// sola vez para los DOS que lo dibujan: la vista de pantalla y el PDF del servidor.
// Si cada uno los calculara por su lado, el día que cambie una regla (una tasa nueva,
// un descuento) el PDF y la pantalla dirían números distintos — y el que vale es el
// que ya salió impreso.

// Datos de la empresa para el encabezado. Viven acá para que no haya dos copias.
export const EMPRESA_DOC = {
  nombre: "Adelante Desarrollos S.A.",
  dir: ["Contiguo a Condominio Valle Ilios", "30801, El Guarco", "El Guarco, Cartago"],
  tel: "4001-7670",
  email: "facturacion@adelantedesarrollos.com",
  cif: "3-101-621790",
  banco: "BAC",
};

// Formato numérico al estilo del reporte de BC: 1,234.56
export function fmtDoc(n: number, dec = 2): string {
  return (n || 0).toLocaleString("en-US", { minimumFractionDigits: dec, maximumFractionDigits: dec });
}

// Destino de una línea: el almacén al que entra y, si no hay, la obra. Es lo que le
// sirve al proveedor (a dónde lo lleva); el N.º de material es interno.
export function destinoLineaDoc(l: OrdenLinea): string {
  return l.almacen || l.proyecto || "";
}

// LA CASA de la línea: la obra para la que se pidió el material.
//
// El almacén dice a dónde lo lleva; la obra dice PARA CUÁL es, y no siempre son lo
// mismo: la compra que entra a ALM-GRAL igual se pidió para una casa. Al proveedor
// que además instala esa es LA dirección del trabajo, y sin ella la orden salía
// diciendo solo "ALM-GRAL".
//
// `obraSolicitud` primero porque es la que puso Ingeniería; `proyecto` es el Job No.
// de BC, que solo existe cuando la compra es consumo directo.
export function casaDeLinea(l: OrdenLinea): string {
  return (l.obraSolicitud || l.proyecto || "").trim();
}

// La casa para el renglón de abajo de la columna "Almacén / Obra".
// Vacío cuando ya es el destino impreso: no se repite el mismo código dos veces.
export function obraLineaDoc(l: OrdenLinea): string {
  const casa = casaDeLinea(l);
  return casa && casa !== destinoLineaDoc(l) ? casa : "";
}

// Rótulo del encabezado cuando el documento mezcla varias cosas en una columna.
const VARIAS = "Varias (ver detalle)";

// LA CASA DEL ENCABEZADO, al lado de "Almacén entrega".
//
// La casa ya iba renglón por renglón, pero ahí abajo nadie la busca: el proveedor lee
// el bloque de arriba, y de ese bloque sale a qué casa va a instalar. Con la obra solo
// en la tabla, la orden llegaba —para él— sin dirección, que es justo el reclamo.
//
// Vacío (no se imprime la fila) cuando ninguna línea tiene casa, y también cuando la
// casa ES el almacén de entrega: en consumo directo el almacén de BC lleva el mismo
// código que el proyecto y sería imprimir dos veces lo mismo.
export function casaDelDocumento(lineas: OrdenLinea[], almacenUnico: string | null): string {
  const casas = [...new Set(lineas.map(casaDeLinea).filter(Boolean))];
  if (!casas.length) return "";
  if (casas.length > 1) return VARIAS;
  return casas[0] === almacenUnico ? "" : casas[0];
}

// BC imprime la DESCRIPCIÓN de la unidad ("ESTAÑON"), no el código ("EST"): es lo
// que el proveedor lee y reconoce. Si no tenemos la descripción (BC caído o unidad
// nueva), va el código — nunca queda en blanco.
export function etiquetaUnidad(code: string, unidades: Record<string, string> = {}): string {
  const c = (code ?? "").trim();
  if (!c) return "";
  const desc = unidades[c] ?? unidades[c.toUpperCase()] ?? "";
  return desc.trim() || c;
}

export type GrupoIva = { pct: number; base: number; iva: number };
export type DocumentoOrden = {
  // El N.º que va al proveedor es el de BUSINESS CENTRAL: es el que existe en el ERP,
  // el que Contabilidad busca y el que él pone en su factura. El interno de la app
  // arranca en 1 en cada base y solo sirve adentro.
  numeroDoc: string;
  moneda: string;
  lineas: OrdenLinea[];
  almacenUnico: string | null;
  // La casa que se imprime en el encabezado ("" = no va la fila). Ver casaDelDocumento.
  casaDoc: string;
  subtotal: number;
  iva: number;
  ivaPct: number;
  total: number;
  porTasaIva: GrupoIva[];
  // código de unidad -> descripción, para imprimir "ESTAÑON" y no "EST".
  unidades: Record<string, string>;
};

export function documentoDeOrden(orden: Orden, unidades: Record<string, string> = {}): DocumentoOrden {
  // El papel que se le manda al proveedor lleva TODAS las líneas: material, recurso
  // y activo fijo primero, y los cargos (flete) al final, como el reporte de BC.
  // Con `tipo === "articulo"` una compra directa de un servicio salía impresa vacía:
  // la orden llegaba al proveedor sin la línea que se le estaba comprando.
  const articulos = orden.lineas.filter(esLineaRecibible);
  const cargos = orden.lineas.filter(esLineaCargo);
  const lineas = [...articulos, ...cargos];
  const destinos = [...new Set(articulos.map(destinoLineaDoc).filter(Boolean))];
  const almacenUnico = destinos.length === 1 ? destinos[0] : null;
  const subtotal = ordenSubtotal(orden);
  const iva = ordenIva(orden);
  // Base e IVA agrupados por tasa: una orden puede mezclar 13% con exento, y meter
  // todo en una fila con la tasa de la primera línea daba una base que no cuadraba.
  const porTasaIva = [...orden.lineas.reduce((m, l) => {
    const pct = Number(l.ivaPct ?? 0);
    const base = ordenLineaImporte(l);
    const g = m.get(pct) ?? { pct, base: 0, iva: 0 };
    g.base += base; g.iva += base * (pct / 100);
    m.set(pct, g);
    return m;
  }, new Map<number, GrupoIva>()).values()].sort((a, b) => b.pct - a.pct);

  return {
    // OJO: acá NO va `numeroOrden()`. Este es el documento que sale hacia afuera y
    // necesita un identificador, no el rótulo de pantalla: al proveedor no se le
    // manda un papel que diga "Interno 37". En la práctica siempre lleva el de BC
    // (el PDF está bloqueado salvo orden lanzada o completada, ver ordenImprimible).
    numeroDoc: orden.bcNumber || orden.numero,
    moneda: orden.currencyCode || "CRC",
    lineas,
    almacenUnico,
    // Los cargos (flete) quedan fuera: un flete no es de una casa, y con él adentro
    // el encabezado se iba a "Varias" por una línea que no lleva obra.
    casaDoc: casaDelDocumento(articulos, almacenUnico),
    subtotal,
    iva,
    // La tasa que rotula el total del papel. El `?? 13` de antes rotulaba "13% IVA"
    // sobre un importe de 0,00 en cuanto la orden iba exenta —que es justo el papel
    // de una importación, el que se le manda al proveedor de afuera (CP-005636, FBG
    // SRL). Si hay líneas y ninguna cobra IVA, la tasa es 0: el 13 queda solo como
    // default de una orden sin líneas que mirar.
    ivaPct: articulos.find((l) => (l.ivaPct ?? 0) > 0)?.ivaPct ?? (articulos.length ? 0 : 13),
    total: subtotal + iva,
    porTasaIva,
    unidades,
  };
}

// Nombre del archivo que se descarga. Con el N.º de BC adelante para que ordene solo
// en la carpeta de descargas. Mismo criterio que `numeroDoc`: el crudo, no el rótulo.
export function nombreArchivoOrden(orden: Orden): string {
  const num = (orden.bcNumber || orden.numero || "orden").replace(/[^\w.-]+/g, "-");
  return `${num}-orden-de-compra.pdf`;
}

// Solo se le manda al proveedor una orden APROBADA (Lanzada en BC) o ya completada.
export function ordenImprimible(orden: Orden): boolean {
  return orden.estado === "lanzado" || orden.estado === "completado";
}
