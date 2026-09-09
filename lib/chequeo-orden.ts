// El cotejo COMPLETO de una orden contra Business Central, con las dos formas de
// mirar según dónde esté la orden. Vive aparte de lib/bc.ts porque necesita las dos
// mitades —BC y SQL— y lo usan dos rutas: el chequeo de una orden y el reporte de
// conciliación que revisa muchas.
//
// La regla: la app nunca "supone" que BC tiene lo mismo. O lo lee y lo compara, o
// dice que no pudo. Ese "no pudo" es distinto de "está mal", y por eso son estados
// distintos: confundirlos fue lo que llenó las pantallas de avisos falsos hasta que
// nadie miró el que era de verdad.
import { getOrden, facturasBcDeOrden, guardarChequeoBc } from "./repo.ts";
import { chequearOrdenContraBc, lineasOrdenParaCotejo, bcLineasFacturaRegistrada, bcLineasFacturadasDePedido } from "./bc.ts";
import { cotejarLineas, proveedoresAjenos, type Diferencia, type LineaBc } from "./bc-conciliacion.ts";
import type { Orden } from "./types.ts";
import type { Role } from "./types.ts";

export type ResultadoChequeo = {
  estado: "ok" | "desalineado" | "sin-pedido" | "sin-lectura" | "sin-bc";
  // Contra QUÉ se comparó. Cambia lo que significa el resultado:
  //   "pedido"  → contra las líneas del pedido de compra (lo que se va a recibir).
  //   "factura" → contra las facturas ya registradas (lo que entró de verdad).
  contra: "pedido" | "factura" | "nada";
  mensaje: string;
  diferencias: Diferencia[];
  importeEnJuego: number;
  facturas?: string[];
};

// Lo que la app dice que se FACTURÓ de esta orden. Es el espejo de una factura de
// compra registrada: contra un documento ya registrado no se compara lo pedido ni lo
// recibido, se compara lo facturado.
// `sinVariante` para el camino que lee la API estándar, que no devuelve su código.
function facturadoDe(orden: Orden, sinVariante = false) {
  return orden.lineas
    // Recurso y activo fijo también se facturan por cantidad: si la app dice que
    // facturó un servicio y en BC no está, es la misma plata perdida que con un
    // material (el caso CP-005172 con otro tipo de línea).
    .filter((l) => l.tipo !== "cargo" && (Number(l.cantidadFacturada) || 0) > 0)
    .map((l) => ({
      id: String(l.id), tipo: l.tipo, itemNo: String(l.articuloId ?? ""),
      variantCode: sinVariante ? "" : String(l.variantCode ?? ""),
      descripcion: l.descripcion ?? "",
      cantidad: Number(l.cantidadFacturada) || 0, precioUnitario: Number(l.precioUnitario) || 0,
      unidad: l.unidad,
    }));
}

export async function chequearOrdenAFondo(
  orden: Orden,
  opts: { persistir?: boolean; usuario?: string; rol?: Role } = {},
): Promise<ResultadoChequeo> {
  const id = Number(orden.id);
  const guardar = async (estado: "ok" | "desalineado" | "sin-pedido", mensaje: string) => {
    if (!opts.persistir) return;
    await guardarChequeoBc(id, estado, mensaje, opts.usuario ?? "sistema", opts.rol ?? "proveeduria")
      .catch(() => { /* el resultado se devuelve igual: guardar es la memoria, no el juicio */ });
  };

  if (!orden.bcNumber) {
    return { estado: "sin-bc", contra: "nada", mensaje: "La orden todavía no tiene pedido en Business Central.", diferencias: [], importeEnJuego: 0 };
  }

  // 1) Contra el PEDIDO (mientras exista allá).
  const chequeo = await chequearOrdenContraBc(orden.bcNumber, lineasOrdenParaCotejo(orden.lineas), orden.proveedorNo || orden.proveedorId, orden.estado);
  if (chequeo.estado === "ok" || chequeo.estado === "desalineado") {
    await guardar(chequeo.estado, chequeo.mensaje);
    return {
      estado: chequeo.estado, contra: "pedido", mensaje: chequeo.mensaje,
      diferencias: chequeo.cotejo?.diferencias ?? [], importeEnJuego: chequeo.cotejo?.importeEnJuego ?? 0,
    };
  }
  if (chequeo.estado === "sin-lectura") {
    return { estado: "sin-lectura", contra: "pedido", mensaje: chequeo.mensaje, diferencias: [], importeEnJuego: 0 };
  }

  // 2) El pedido ya no está en BC. En una orden COMPLETADA eso es lo normal (BC lo
  //    borra al registrarlo todo), así que la pregunta pasa a ser otra: ¿lo que se
  //    facturó acá es lo que BC registró? Se compara contra las facturas registradas.
  // Camino BUENO: preguntarle a BC qué registró CONTRA ESTE PEDIDO. No depende de que
  // la app haya guardado el N.º del documento (solo lo hace desde el 1/9/2026), así que
  // alcanza también a las órdenes viejas — que son las que nunca nadie revisó.
  const porPedido = await bcLineasFacturadasDePedido(orden.bcNumber);
  if (porPedido && porPedido.length) {
    const facturadoApp = facturadoDe(orden);
    const cotejo = cotejarLineas(facturadoApp, porPedido, { ignorarVariante: false });
    const docs = [...new Set(porPedido.map((l) => l.documentNo).filter(Boolean))];

    // EL PROVEEDOR MANDA SOBRE LAS LÍNEAS. Mismo criterio que para el pedido vivo:
    // que los artículos, cantidades y precios cuadren no dice nada si la factura
    // quedó cargada a la cuenta por pagar de otro proveedor. Y es lo peor que puede
    // salir mal acá, porque a esta altura ya solo se deshace con una nota de
    // crédito. Así se escapó CFR-009891 (CP-005289, Mercasa facturada a EPA): las
    // líneas cuadraban y el detector la daba por buena.
    const ajenas = proveedoresAjenos(porPedido, String(orden.proveedorNo || orden.proveedorId || ""));
    if (ajenas.length) {
      const mensaje =
        `FACTURA A NOMBRE DE OTRO PROVEEDOR — ${docs.length ? `el/los documento(s) ${docs.join(", ")}` : `lo registrado contra ${orden.bcNumber}`} `
        + `en Business Central está a nombre de ${ajenas.join(", ")}, pero esta orden es de ${orden.proveedorNo || orden.proveedorId}`
        + `${orden.proveedorNombre ? ` (${orden.proveedorNombre})` : ""}. `
        + `La compra quedó cargada a la cuenta por pagar del proveedor equivocado. `
        + `Eso ya no se corrige reenviando la orden: Contabilidad tiene que emitir una nota de crédito de esa factura y volver a registrarla contra el proveedor correcto.`
        + (cotejo.ok ? "" : ` Además, las líneas no coinciden: ${cotejo.resumen}`);
      await guardar("desalineado", mensaje);
      return {
        estado: "desalineado", contra: "factura", facturas: docs,
        mensaje, diferencias: cotejo.diferencias, importeEnJuego: cotejo.importeEnJuego,
      };
    }

    // BC YA FACTURÓ ESTE PEDIDO Y LA APP NO SE ENTERÓ. Es distinto de "las líneas no
    // cuadran": acá la app no facturó NADA, así que cotejar línea por línea acusa a
    // todas de faltar y saca un "no coinciden en 1 línea — ₡1.190.159,30" que suena a
    // plata perdida cuando lo único que pasa es que la orden se quedó en Lanzado.
    // Son ~18 órdenes: dicho así llenan el aviso todos los días y entierran al que sí
    // importa — exactamente cómo se pasó por alto CP-005172 en su momento.
    if (!facturadoApp.length) {
      const mensaje =
        `Business Central YA registró ${docs.length ? docs.join(", ") : "documentos"} contra el pedido ${orden.bcNumber}, `
        + `pero acá la orden sigue en ${orden.estado} y no tiene nada facturado. `
        + `No es una diferencia de líneas: es que la recepción se hizo en BC y no en la app. `
        + `Registrala acá o cerrala para que deje de aparecer.`;
      await guardar("desalineado", mensaje);
      return {
        estado: "desalineado", contra: "factura", facturas: docs,
        mensaje, diferencias: [], importeEnJuego: 0,
      };
    }

    const mensaje = cotejo.ok
      ? `Lo facturado coincide con lo que Business Central registró contra ${orden.bcNumber}${docs.length ? ` (${docs.join(", ")})` : ""}.`
      : `La orden y lo que Business Central registró contra ${orden.bcNumber}${docs.length ? ` (${docs.join(", ")})` : ""} NO coinciden. ${cotejo.resumen}`;
    await guardar(cotejo.ok ? "ok" : "desalineado", mensaje);
    return {
      estado: cotejo.ok ? "ok" : "desalineado", contra: "factura", facturas: docs,
      mensaje, diferencias: cotejo.diferencias, importeEnJuego: cotejo.importeEnJuego,
    };
  }

  // Camino de respaldo: por el N.º de factura que la app guardó al registrar.
  const facturas = await facturasBcDeOrden(id);
  if (!facturas.length) {
    const mensaje = orden.estado === "completado"
      ? `Orden completada y sin N.º de factura de BC guardado: no hay contra qué cotejarla. (BC borra el pedido ${orden.bcNumber} al registrarlo todo; la factura registrada hay que buscarla allá por proveedor y fecha.)`
      : `Business Central no tiene el pedido ${orden.bcNumber} y la orden no está completada: o lo borraron allá, o nunca se creó.`;
    if (orden.estado !== "completado") await guardar("sin-pedido", mensaje);
    return { estado: orden.estado === "completado" ? "sin-lectura" : "sin-pedido", contra: "pedido", mensaje, diferencias: [], importeEnJuego: 0 };
  }

  const lineasBc: LineaBc[] = [];
  let sinLeer = 0;
  for (const f of facturas) {
    const l = await bcLineasFacturaRegistrada(f);
    if (l === null) { sinLeer++; continue; }
    lineasBc.push(...l);
  }
  if (sinLeer === facturas.length) {
    return {
      estado: "sin-lectura", contra: "factura", facturas,
      mensaje: `No se pudieron leer en Business Central la(s) factura(s) ${facturas.join(", ")}.`,
      diferencias: [], importeEnJuego: 0,
    };
  }

  // Se compara lo FACTURADO (no lo recibido): el espejo de una factura de compra
  // registrada es la cantidad facturada de la línea. Sin variante: la API estándar
  // de líneas de factura no devuelve su código.
  const cotejo = cotejarLineas(facturadoDe(orden, true), lineasBc, { ignorarVariante: true });
  const cola = sinLeer ? ` (${sinLeer} factura(s) no se pudieron leer)` : "";
  const mensaje = cotejo.ok
    ? `Lo facturado coincide con ${facturas.join(", ")} en Business Central${cola}.`
    : `La orden y la(s) factura(s) ${facturas.join(", ")} registradas en Business Central NO coinciden. ${cotejo.resumen}${cola}`;
  await guardar(cotejo.ok ? "ok" : "desalineado", mensaje);
  return {
    estado: cotejo.ok ? "ok" : "desalineado", contra: "factura", facturas,
    mensaje, diferencias: cotejo.diferencias, importeEnJuego: cotejo.importeEnJuego,
  };
}

// Misma cosa, a partir del id (la usan las rutas).
export async function chequearOrdenPorId(id: number, opts: { persistir?: boolean; usuario?: string; rol?: Role } = {}) {
  const o = await getOrden(id);
  if (!o) return null;
  return { orden: o, resultado: await chequearOrdenAFondo(o, opts) };
}
