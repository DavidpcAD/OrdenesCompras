import { NextRequest, NextResponse } from "next/server";
import { listOrdenes } from "@/lib/repo";
import { chequearOrdenAFondo } from "@/lib/chequeo-orden";
import { actor } from "@/lib/actor";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// GET /api/reportes/conciliacion-bc?desde=2026-08-01&limite=25&saltar=0&solo=desalineadas
//
// EL DETECTOR. Recorre las órdenes que viven en Business Central y compara, una por
// una, lo que dice la app contra lo que dice BC. Es la respuesta a "¿en cuántas
// órdenes más pasó esto?" — porque CP-005172 no se descubrió con una alarma, se
// descubrió porque alguien puso una factura de papel al lado de una pantalla.
//
// Va POR TANDAS a propósito: cada orden son una o dos llamadas a BC (medio segundo
// larga cada una), así que barrer un año entero de una sola vez se muere por timeout
// y encima castiga a BC. La pantalla pide `limite` órdenes, muestra lo que salió y
// sigue con `saltar` = las que ya revisó. El resultado de cada una queda guardado en
// la orden, así que lo ya revisado no se pierde entre tandas.
const LIMITE_MAX = 40;
const EN_PARALELO = 4;   // BC aguanta bien esto; más arriba empieza a tirar 429.

export async function GET(req: NextRequest) {
  try {
    const sp = req.nextUrl.searchParams;
    const desde = (sp.get("desde") ?? "").trim();
    const hasta = (sp.get("hasta") ?? "").trim();
    const solo = (sp.get("solo") ?? "").trim();          // "desalineadas" = devolver solo lo que no cuadra
    const limite = Math.min(Math.max(Number(sp.get("limite") ?? 15) || 15, 1), LIMITE_MAX);
    const saltar = Math.max(Number(sp.get("saltar") ?? 0) || 0, 0);
    const a = await actor({}).catch(() => ({ usuario: "sistema", rol: "proveeduria" as const }));

    // Solo tiene sentido cotejar lo que existe en BC. Se recorren de la más nueva a
    // la más vieja: si algo se rompió hace poco, aparece en la primera tanda.
    const todas = (await listOrdenes())
      .filter((o) => !!o.bcNumber)
      .filter((o) => (!desde || o.fecha >= desde) && (!hasta || o.fecha <= hasta));
    const tanda = todas.slice(saltar, saltar + limite);

    const filas: any[] = [];
    for (let i = 0; i < tanda.length; i += EN_PARALELO) {
      const grupo = tanda.slice(i, i + EN_PARALELO);
      const res = await Promise.all(grupo.map(async (o) => {
        try {
          const r = await chequearOrdenAFondo(o, { persistir: true, usuario: a.usuario, rol: a.rol });
          return {
            id: o.id, numero: o.numero, bcNumber: o.bcNumber, fecha: o.fecha,
            proveedor: o.proveedorNombre ?? o.proveedorNo ?? o.proveedorId,
            estadoOrden: o.estado, moneda: o.currencyCode || "CRC",
            estado: r.estado, contra: r.contra, mensaje: r.mensaje,
            importeEnJuego: r.importeEnJuego,
            diferencias: r.diferencias.map((d) => ({ clase: d.clase, itemNo: d.itemNo, variantCode: d.variantCode, descripcion: d.descripcion, cantidadApp: d.cantidadApp, cantidadBc: d.cantidadBc, importe: d.importe, texto: d.texto })),
            facturas: r.facturas ?? [],
          };
        } catch (e: any) {
          // Una orden que revienta no puede matar la tanda entera: se reporta como
          // "no se pudo" y se sigue. Callarla sería peor que no revisarla.
          return {
            id: o.id, numero: o.numero, bcNumber: o.bcNumber, fecha: o.fecha,
            proveedor: o.proveedorNombre ?? o.proveedorNo ?? o.proveedorId,
            estadoOrden: o.estado, moneda: o.currencyCode || "CRC",
            estado: "sin-lectura", contra: "nada", mensaje: String(e?.message ?? e),
            importeEnJuego: 0, diferencias: [], facturas: [],
          };
        }
      }));
      filas.push(...res);
    }

    const devueltas = solo === "desalineadas" ? filas.filter((f) => f.estado === "desalineado" || f.estado === "sin-pedido") : filas;
    return NextResponse.json({
      total: todas.length,
      revisadas: saltar + tanda.length,
      quedan: Math.max(0, todas.length - (saltar + tanda.length)),
      filas: devueltas,
      // El resumen se calcula sobre TODAS las de la tanda, no sobre las devueltas:
      // si no, filtrar cambiaría los números y el reporte mentiría por omisión.
      resumen: {
        ok: filas.filter((f) => f.estado === "ok").length,
        desalineadas: filas.filter((f) => f.estado === "desalineado").length,
        sinPedido: filas.filter((f) => f.estado === "sin-pedido").length,
        sinLectura: filas.filter((f) => f.estado === "sin-lectura").length,
        importeEnJuego: filas.reduce((s, f) => s + (Number(f.importeEnJuego) || 0), 0),
      },
    });
  } catch (e: any) {
    return NextResponse.json({ error: String(e?.message ?? e) }, { status: 500 });
  }
}
