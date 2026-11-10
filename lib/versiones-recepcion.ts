// ════════════════════════════════════════════════════════════════════════════════
// LAS VERSIONES DE UNA RECEPCIÓN: cómo entró y cómo fue cambiando hasta su factura.
//
// Una recepción que queda en revisión puede cambiar antes de facturarse: el precio
// se corrige ("Corregir precio", lib/corregir-precio.ts) y la recepción pasa a
// valer otra cosa. Sin esto la pantalla mostraba solo el estado de AHORA y el de
// cuando Bodega la recibió se perdía: nadie podía ver qué se recibió a qué precio.
//
// No hay tabla de versiones: todo sale de la BITÁCORA, que ya guarda cada cambio con
// quién, cuándo y por qué. La versión 1 es como entró; cada corrección de precio de la
// orden posterior a la recepción (y anterior a su factura) es una versión nueva; y la
// factura registrada cierra la lista. Los precios de las versiones viejas se
// reconstruyen deshaciendo las correcciones desde el precio de hoy.
//
// Todo acá es PURO: ver versiones-recepcion.test.ts.
// ════════════════════════════════════════════════════════════════════════════════

import { leerCorreccionPrecio, MOV_PRECIO_CORREGIDO } from "./corregir-precio.ts";
import { MARCA_DESDE_REVISION } from "./helpers.ts";
import { codigoDeItem } from "./unidad.ts";
import type { Movimiento, Orden, Recepcion } from "./types.ts";

export type LineaDeVersion = {
  ordenLineaId: string; descripcion: string; codigo: string; cantidad: number; unidad: string;
  precio: number; importe: number;
};
export type VersionRecepcion = {
  n: number;
  tipo: "recibida" | "precio" | "factura";
  fecha: string;        // ISO (o yyyy-mm-dd si la bitácora no la trae)
  usuario: string;
  motivo?: string;
  numeroFactura?: string;
  // Lo que cambió respecto de la versión anterior, tal como lo dice la bitácora.
  cambios: { descripcion: string; antesTxt: string; nuevoTxt: string }[];
  lineas: LineaDeVersion[];
  subtotal: number;
  iva: number;
  total: number;
};

const CASI = 0.005;
const asc = (a: Movimiento, b: Movimiento) => (a.fecha < b.fecha ? -1 : a.fecha > b.fecha ? 1 : 0);

export function versionesDeRecepcion(
  rec: Recepcion,
  orden: Orden | undefined,
  movsRecepcion: Movimiento[],
  movsOrden: Movimiento[],
): VersionRecepcion[] {
  if (!orden) return [];
  const propios = movsRecepcion.filter((m) => m.entidad === "recepcion" && String(m.idEntidad) === String(rec.id)).sort(asc);
  // Cómo entró. Una recepción que llegó con su factura ("creado") no tiene versiones:
  // el precio quedó fijado por la factura en el mismo momento.
  const entrada = propios.find((m) => m.tipoMovimiento === "recibido");
  if (!entrada) return [];
  const facturada = propios.find((m) => (m.detalle ?? "").includes(MARCA_DESDE_REVISION));
  const desde = entrada.fecha || rec.fechaRecepcion;
  const hasta = facturada?.fecha;

  const lineas = rec.lineas.map((rl) => {
    const ol = orden.lineas.find((l) => String(l.id) === String(rl.ordenLineaId));
    return {
      rl, ol,
      codigo: ol ? codigoDeItem(String(ol.articuloId ?? "")) : "",
      // Un precio anotado en la propia recepción (el de la factura) no lo mueve una
      // corrección de la orden.
      fija: rl.precioFactura != null,
      precioHoy: rl.precioFactura ?? ol?.precioUnitario ?? 0,
    };
  });

  const correcciones = movsOrden
    .filter((m) => m.entidad === "orden" && String(m.idEntidad) === String(orden.id) && m.tipoMovimiento === MOV_PRECIO_CORREGIDO
      && m.fecha > desde && (!hasta || m.fecha <= hasta))
    .sort(asc)
    .map((m) => ({ m, c: leerCorreccionPrecio(m.detalle) }))
    .filter((x): x is { m: Movimiento; c: NonNullable<ReturnType<typeof leerCorreccionPrecio>> } =>
      !!x.c && x.c.cambios.some((cb) => lineas.some((l) => !l.fija && l.codigo === cb.codigo)));
  if (!correcciones.length) return [];

  // De atrás para adelante: el precio de hoy, deshaciendo cada corrección (solo donde
  // la línea tiene justo el precio que esa corrección puso), da el de la entrada.
  const precio = new Map(lineas.map((l) => [String(l.rl.ordenLineaId), l.precioHoy]));
  for (const { c } of [...correcciones].reverse()) {
    for (const cb of c.cambios) {
      for (const l of lineas) {
        const id = String(l.rl.ordenLineaId);
        if (!l.fija && l.codigo === cb.codigo && Math.abs((precio.get(id) ?? 0) - cb.nuevo) < CASI) precio.set(id, cb.antes);
      }
    }
  }

  const foto = (): Pick<VersionRecepcion, "lineas" | "subtotal" | "iva" | "total"> => {
    let subtotal = 0; let iva = 0;
    const ls = lineas.map((l) => {
      const p = precio.get(String(l.rl.ordenLineaId)) ?? 0;
      const importe = Math.round(l.rl.cantidadRecibida * p * (1 - (l.ol?.descuentoPct ?? 0) / 100) * 100) / 100;
      subtotal += importe;
      iva += importe * ((l.ol?.ivaPct ?? 0) / 100);
      return {
        ordenLineaId: String(l.rl.ordenLineaId), descripcion: l.ol?.descripcion ?? "Línea que ya no está en la orden",
        codigo: l.codigo, cantidad: l.rl.cantidadRecibida, unidad: l.ol?.unidad ?? "", precio: p, importe,
      };
    });
    const r2 = (n: number) => Math.round(n * 100) / 100;
    return { lineas: ls, subtotal: r2(subtotal), iva: r2(iva), total: r2(subtotal + iva) };
  };

  const versiones: VersionRecepcion[] = [{
    n: 1, tipo: "recibida", fecha: desde, usuario: rec.recibidoPor || entrada.usuario, cambios: [], ...foto(),
  }];
  for (const { m, c } of correcciones) {
    const cambios: VersionRecepcion["cambios"] = [];
    for (const cb of c.cambios) {
      for (const l of lineas) {
        const id = String(l.rl.ordenLineaId);
        if (!l.fija && l.codigo === cb.codigo && Math.abs((precio.get(id) ?? 0) - cb.antes) < CASI) {
          precio.set(id, cb.nuevo);
          cambios.push({ descripcion: l.ol?.descripcion ?? cb.descripcion, antesTxt: cb.antesTxt, nuevoTxt: cb.nuevoTxt });
        }
      }
    }
    if (!cambios.length) continue;
    versiones.push({ n: versiones.length + 1, tipo: "precio", fecha: m.fecha, usuario: m.usuario, motivo: c.motivo || undefined, cambios, ...foto() });
  }
  if (facturada) {
    versiones.push({
      n: versiones.length + 1, tipo: "factura", fecha: facturada.fecha, usuario: facturada.usuario,
      numeroFactura: facturada.documentoNo || rec.numeroFactura || undefined, cambios: [], ...foto(),
    });
  }
  return versiones.length > 1 ? versiones : [];
}
