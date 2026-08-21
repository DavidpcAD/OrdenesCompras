import type { Orden, OrdenLinea } from "./types";
import { ordenLineaImporte } from "./helpers";

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

export type GrupoIva = { pct: number; base: number; iva: number };
export type DocumentoOrden = {
  // El N.º que va al proveedor es el de BUSINESS CENTRAL: es el que existe en el ERP,
  // el que Contabilidad busca y el que él pone en su factura. El interno de la app
  // arranca en 1 en cada base y solo sirve adentro.
  numeroDoc: string;
  moneda: string;
  lineas: OrdenLinea[];
  almacenUnico: string | null;
  subtotal: number;
  iva: number;
  ivaPct: number;
  total: number;
  porTasaIva: GrupoIva[];
};

export function documentoDeOrden(orden: Orden): DocumentoOrden {
  const articulos = orden.lineas.filter((l) => l.tipo === "articulo");
  const cargos = orden.lineas.filter((l) => l.tipo === "cargo");
  const lineas = [...articulos, ...cargos];
  const destinos = [...new Set(articulos.map(destinoLineaDoc).filter(Boolean))];
  const subtotal = orden.lineas.reduce((s, l) => s + ordenLineaImporte(l), 0);
  const iva = orden.lineas.reduce((s, l) => s + ordenLineaImporte(l) * ((l.ivaPct ?? 0) / 100), 0);
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
    numeroDoc: orden.bcNumber || orden.numero,
    moneda: orden.currencyCode || "CRC",
    lineas,
    almacenUnico: destinos.length === 1 ? destinos[0] : null,
    subtotal,
    iva,
    ivaPct: articulos.find((l) => (l.ivaPct ?? 0) > 0)?.ivaPct ?? 13,
    total: subtotal + iva,
    porTasaIva,
  };
}

// Nombre del archivo que se descarga. Con el N.º de BC adelante para que ordene solo
// en la carpeta de descargas.
export function nombreArchivoOrden(orden: Orden): string {
  const num = (orden.bcNumber || orden.numero || "orden").replace(/[^\w.-]+/g, "-");
  return `${num}-orden-de-compra.pdf`;
}

// Solo se le manda al proveedor una orden APROBADA (Lanzada en BC) o ya completada.
export function ordenImprimible(orden: Orden): boolean {
  return orden.estado === "lanzado" || orden.estado === "completado";
}
