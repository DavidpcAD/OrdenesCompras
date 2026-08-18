import type { Orden, OrdenEstado, Pedido } from "./types";

/* ============================================================================
   Reportes de compras.

   Todo sale de lo que la app YA tiene cargado (órdenes + solicitudes): no hay
   endpoint nuevo ni consulta aparte. La unidad es la LÍNEA de orden — una
   compra concreta de un material — y de ahí se agrupa por material, por obra
   (centro de costo) o por persona.

   Las funciones son puras a propósito: la pantalla solo filtra y pinta, y la
   aritmética queda cubierta por lib/reportes.test.ts.
   ============================================================================ */

// Una línea de artículo comprada, con todo lo que hace falta para los reportes
// ya resuelto (proveedor, obra, quién la pidió, quién hizo la orden).
export interface CompraFila {
  ordenId: string;
  ordenNumero: string;
  bcNumber?: string;
  fecha: string;                 // ISO de emisión de la orden
  estado: OrdenEstado;
  proveedorNo: string;
  proveedorNombre: string;
  itemNo: string;                // código del material ("" si es una línea sin código)
  descripcion: string;
  unidad: string;
  cantidad: number;
  precioUnitario: number;
  descuentoPct: number;
  importe: number;               // cantidad × precio − descuento (sin IVA)
  moneda: string;                // "" = CRC
  obra: string;                  // Job No. de la línea, o la obra de la solicitud
  almacen: string;
  pedidoNumero: string;          // solicitud de origen ("" si es compra directa)
  solicitante: string;           // quién pidió el material
  compradorOC: string;           // quién generó la orden de compra
}

export interface FiltroReporte {
  desde?: string;                // ISO (inclusive)
  hasta?: string;                // ISO (inclusive)
  texto?: string;                // código o descripción del material
  obra?: string;
  proveedorNo?: string;
  // Por defecto solo cuentan las órdenes que REALMENTE se compraron (lanzadas o
  // completadas). Una orden en borrador o rechazada no es una compra.
  incluirNoAprobadas?: boolean;
}

const ESTADOS_COMPRADOS: OrdenEstado[] = ["lanzado", "completado"];

// Importe de una línea sin IVA, con el descuento aplicado.
export function importeLinea(cantidad: number, precio: number, descuentoPct = 0): number {
  const bruto = (Number(cantidad) || 0) * (Number(precio) || 0);
  return bruto * (1 - (Number(descuentoPct) || 0) / 100);
}

// Solo la parte de fecha, para comparar contra los filtros desde/hasta sin que
// la hora del ISO haga que "hasta = hoy" deje fuera lo de hoy.
const soloFecha = (iso: string) => String(iso ?? "").slice(0, 10);

// Aplana órdenes + solicitudes a líneas de compra. Las líneas de CARGO (flete,
// seguro) se dejan fuera: no son un material comprado y ensuciarían el historial
// de precios.
export function filasDeCompra(ordenes: Orden[], pedidos: Pedido[], filtro: FiltroReporte = {}): CompraFila[] {
  const porNumero = new Map(pedidos.map((p) => [p.numero, p]));
  const porLinea = new Map<string, Pedido>();
  for (const p of pedidos) for (const l of p.lineas) porLinea.set(l.id, p);

  const texto = (filtro.texto ?? "").trim().toLowerCase();
  const desde = filtro.desde ? soloFecha(filtro.desde) : "";
  const hasta = filtro.hasta ? soloFecha(filtro.hasta) : "";

  const filas: CompraFila[] = [];
  for (const o of ordenes) {
    if (!filtro.incluirNoAprobadas && !ESTADOS_COMPRADOS.includes(o.estado)) continue;
    const f = soloFecha(o.fecha);
    if (desde && f < desde) continue;
    if (hasta && f > hasta) continue;
    if (filtro.proveedorNo && (o.proveedorNo ?? "") !== filtro.proveedorNo) continue;

    for (const l of o.lineas) {
      if (l.tipo === "cargo") continue;
      const ped = (l.pedidoLineaId && porLinea.get(l.pedidoLineaId)) || (l.pedidoNumero ? porNumero.get(l.pedidoNumero) : undefined);
      // La obra sale de la línea (Job No.); si la orden no la trae, se cae al destino
      // de la solicitud de origen, que es donde Ingeniería lo puso: la obra si es
      // material, la máquina si es un repuesto (las dos son centro de costo).
      const destinoPedido = ped ? (ped.tipoSolicitud === "repuesto" ? ped.maquinaNo : ped.obraCodigo) : undefined;
      const obra = l.proyecto || destinoPedido || "";
      if (filtro.obra && obra !== filtro.obra) continue;
      if (texto) {
        const heno = `${l.articuloId ?? ""} ${l.descripcion ?? ""}`.toLowerCase();
        if (!heno.includes(texto)) continue;
      }
      filas.push({
        ordenId: o.id,
        ordenNumero: o.numero,
        bcNumber: o.bcNumber,
        fecha: o.fecha,
        estado: o.estado,
        proveedorNo: o.proveedorNo ?? "",
        proveedorNombre: o.proveedorNombre ?? "",
        itemNo: l.articuloId ?? "",
        descripcion: l.descripcion ?? "",
        unidad: l.unidad ?? "",
        cantidad: Number(l.cantidad) || 0,
        precioUnitario: Number(l.precioUnitario) || 0,
        descuentoPct: Number(l.descuentoPct) || 0,
        importe: importeLinea(l.cantidad, l.precioUnitario, l.descuentoPct),
        moneda: o.currencyCode || "",
        obra,
        almacen: l.almacen ?? "",
        pedidoNumero: l.pedidoNumero ?? ped?.numero ?? "",
        solicitante: ped?.solicitante ?? "",
        compradorOC: o.creadoPor ?? "",
      });
    }
  }
  // Más reciente primero: es como se lee un historial.
  return filas.sort((a, b) => (a.fecha < b.fecha ? 1 : a.fecha > b.fecha ? -1 : 0));
}

// Importes sumados POR MONEDA. Sumar colones con dólares daría un número que no
// existe, así que se guardan aparte y la pantalla los muestra por separado.
export type ImportePorMoneda = Record<string, number>;

function sumarPorMoneda(filas: CompraFila[]): ImportePorMoneda {
  const m: ImportePorMoneda = {};
  for (const f of filas) m[f.moneda] = (m[f.moneda] ?? 0) + f.importe;
  return m;
}

const unicos = (xs: string[]) => [...new Set(xs.filter(Boolean))];

export interface GrupoMaterial {
  key: string;                   // itemNo, o la descripción si no tiene código
  itemNo: string;
  descripcion: string;
  unidad: string;
  ordenes: number;               // cuántas ÓRDENES distintas lo compraron
  lineas: number;
  cantidad: number;
  importePorMoneda: ImportePorMoneda;
  // Estadística de precio, solo sobre la moneda de la compra más reciente: mezclar
  // ₡ con $ daría un "precio promedio" sin sentido.
  moneda: string;
  monedasMezcladas: boolean;
  precioMin: number;
  precioMax: number;
  precioPromedio: number;        // ponderado por cantidad (no promedio simple)
  ultimaFecha: string;
  ultimoPrecio: number;
  ultimoProveedor: string;
  proveedores: string[];
  obras: string[];
  filas: CompraFila[];
}

// Historial por material: cuántas veces se compró, a quién, a qué precio y para
// qué obra. Responde "¿esto ya lo compramos? ¿a cómo?".
export function porMaterial(filas: CompraFila[]): GrupoMaterial[] {
  const grupos = new Map<string, CompraFila[]>();
  for (const f of filas) {
    const k = f.itemNo || f.descripcion;
    (grupos.get(k) ?? grupos.set(k, []).get(k)!).push(f);
  }
  const salida: GrupoMaterial[] = [];
  for (const [key, fs] of grupos) {
    // `filasDeCompra` ya ordenó por fecha desc, así que la primera es la última compra.
    const ultima = fs[0];
    const monedas = unicos(fs.map((f) => f.moneda || "CRC"));
    const mismaMoneda = fs.filter((f) => f.moneda === ultima.moneda);
    const precios = mismaMoneda.map((f) => f.precioUnitario).filter((p) => p > 0);
    const cantMoneda = mismaMoneda.reduce((s, f) => s + f.cantidad, 0);
    const impMoneda = mismaMoneda.reduce((s, f) => s + f.importe, 0);
    salida.push({
      key,
      itemNo: ultima.itemNo,
      descripcion: ultima.descripcion,
      unidad: ultima.unidad,
      ordenes: unicos(fs.map((f) => f.ordenId)).length,
      lineas: fs.length,
      cantidad: fs.reduce((s, f) => s + f.cantidad, 0),
      importePorMoneda: sumarPorMoneda(fs),
      moneda: ultima.moneda,
      monedasMezcladas: monedas.length > 1,
      precioMin: precios.length ? Math.min(...precios) : 0,
      precioMax: precios.length ? Math.max(...precios) : 0,
      precioPromedio: cantMoneda > 0 ? impMoneda / cantMoneda : 0,
      ultimaFecha: ultima.fecha,
      ultimoPrecio: ultima.precioUnitario,
      ultimoProveedor: ultima.proveedorNombre || ultima.proveedorNo,
      proveedores: unicos(fs.map((f) => f.proveedorNombre || f.proveedorNo)),
      obras: unicos(fs.map((f) => f.obra)),
      filas: fs,
    });
  }
  return salida.sort((a, b) => (a.ultimaFecha < b.ultimaFecha ? 1 : a.ultimaFecha > b.ultimaFecha ? -1 : 0));
}

export interface GrupoClave {
  clave: string;                 // obra, solicitante o comprador
  ordenes: number;
  lineas: number;
  materiales: number;
  importePorMoneda: ImportePorMoneda;
  filas: CompraFila[];
}

// Agrupa por un campo de la línea (obra = centro de costo, solicitante, comprador).
// Las filas sin valor caen en `sinValor` para que no desaparezcan del total.
export function agruparPor(filas: CompraFila[], campo: "obra" | "solicitante" | "compradorOC", sinValor = "(sin asignar)"): GrupoClave[] {
  const grupos = new Map<string, CompraFila[]>();
  for (const f of filas) {
    const k = f[campo] || sinValor;
    (grupos.get(k) ?? grupos.set(k, []).get(k)!).push(f);
  }
  return [...grupos].map(([clave, fs]) => ({
    clave,
    ordenes: unicos(fs.map((f) => f.ordenId)).length,
    lineas: fs.length,
    materiales: unicos(fs.map((f) => f.itemNo || f.descripcion)).length,
    importePorMoneda: sumarPorMoneda(fs),
    filas: fs,
  })).sort((a, b) => totalCRC(b.importePorMoneda) - totalCRC(a.importePorMoneda));
}

// Para ORDENAR nada más: toma el importe en la moneda local. No es una conversión
// (no hay tipo de cambio acá); solo evita que el orden dependa del azar.
export function totalCRC(m: ImportePorMoneda): number {
  return (m[""] ?? 0) + (m["CRC"] ?? 0);
}

// Catálogos para los filtros, sacados de las órdenes que hay (no de un maestro):
// así el desplegable solo ofrece valores que devuelven resultados.
export function opcionesDeFiltro(ordenes: Orden[], pedidos: Pedido[]) {
  const todas = filasDeCompra(ordenes, pedidos, { incluirNoAprobadas: true });
  return {
    obras: unicos(todas.map((f) => f.obra)).sort(),
    proveedores: [...new Map(todas.filter((f) => f.proveedorNo).map((f) => [f.proveedorNo, f.proveedorNombre || f.proveedorNo])).entries()]
      .sort((a, b) => a[1].localeCompare(b[1])),
  };
}

// CSV para abrirlo en Excel. Separador ";" y BOM: es lo que espera el Excel en
// español (con "," parte mal las columnas y sin BOM rompe los acentos).
export function aCsv(filas: CompraFila[]): string {
  const cab = ["Fecha", "Orden", "BC", "Estado", "Proveedor No", "Proveedor", "Material", "Descripcion", "Cantidad", "Unidad",
    "Precio unitario", "Descuento %", "Importe", "Moneda", "Obra", "Almacen", "Solicitud", "Solicitante", "Genero la OC"];
  const esc = (v: unknown) => {
    const s = String(v ?? "");
    return /[";\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const num = (n: number) => String(n).replace(".", ",");   // decimal con coma, como el Excel local
  const filasCsv = filas.map((f) => [
    soloFecha(f.fecha), f.ordenNumero, f.bcNumber ?? "", f.estado, f.proveedorNo, f.proveedorNombre,
    f.itemNo, f.descripcion, num(f.cantidad), f.unidad, num(f.precioUnitario), num(f.descuentoPct),
    num(Math.round(f.importe * 100) / 100), f.moneda || "CRC", f.obra, f.almacen, f.pedidoNumero, f.solicitante, f.compradorOC,
  ].map(esc).join(";"));
  return "﻿" + [cab.join(";"), ...filasCsv].join("\r\n");
}
