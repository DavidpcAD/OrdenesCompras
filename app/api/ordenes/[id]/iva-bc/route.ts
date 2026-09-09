import { NextResponse } from "next/server";
import { anotarIvaExoneradoEnBc, aplicarIvaDeBcEnOrden, getOrden } from "@/lib/repo";
import { bcExonerarLineasPedido, bcIvaDeLineasOrden } from "@/lib/bc";
import { actor } from "@/lib/actor";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Alinear el IVA de la orden con el que Business Central va a contabilizar.
//
// El IVA% de la app es solo su estimado: no viaja a BC, que lo calcula cruzando el
// grupo de IVA del proveedor con el del artículo. Cuando no coinciden, el total de la
// orden, el del PDF que firma el proveedor y el que ve quien aprueba quedan mal
// (CP-005254: la app decía 0% y BC cobra 13% del artículo, ₡1.270,16 de diferencia).
//
// BC es la fuente y la app copia. Si el que está mal es el de BC (una compra del
// exterior donde el impuesto de aduana ya va en su línea de cargo), el camino ya no es
// ir a corregirlo a mano allá: `accion: "exonerar"` se lo empuja a BC desde acá.
//
// Dos acciones sobre la misma cosa —el IVA de esta orden contra el de su pedido—, por
// eso viven en la misma ruta:
//   - "alinear"  (default): BC manda, la orden copia. No toca BC.
//   - "exonerar": la orden manda, se le quita el IVA al pedido EN BC y después la
//     orden se alinea con lo que BC haya quedado calculando.
export async function POST(req: Request, { params }: { params: { id: string } }) {
  try {
    const body = await req.json().catch(() => ({}));
    const a = await actor(body);
    const id = Number(params.id);
    const accion = String((body as any)?.accion ?? "alinear").toLowerCase();
    const orden = await getOrden(id);
    if (!orden) return NextResponse.json({ error: "Orden no encontrada." }, { status: 404 });
    if (!orden.bcNumber) {
      return NextResponse.json({
        error: accion === "exonerar"
          ? "Esta orden todavía no existe en Business Central, así que allá no hay pedido al que quitarle el IVA. Se crea al enviarla a aprobación."
          : "Esta orden todavía no existe en Business Central, así que no hay IVA de allá que copiar. Se crea al enviarla a aprobación.",
      }, { status: 409 });
    }

    if (accion === "exonerar") {
      const r = await bcExonerarLineasPedido(orden.bcNumber);
      const resumen = [
        `Pedido ${orden.bcNumber} exento de IVA en Business Central (grupo ${r.grupo})`,
        r.cambiadas.length ? `líneas: ${r.cambiadas.join(" · ")}` : "ninguna línea hacía falta cambiar",
        `IVA de BC: ${r.ivaAntes.toFixed(2)} → ${r.ivaDespues.toFixed(2)} ${r.moneda}`.trim(),
        r.aviso ? `OJO: ${r.aviso}` : "",
      ].filter(Boolean).join(" · ");
      const ordenNo = await anotarIvaExoneradoEnBc(id, resumen, a.usuario, a.rol);
      // Y la orden se queda con lo que BC calcula ahora, para que el total de la
      // pantalla, el del PDF del proveedor y el de BC digan lo mismo. Mejor esfuerzo:
      // el cambio que importaba ya quedó hecho en BC.
      let alineadas = 0;
      let avisoAlineado: string | undefined;
      try {
        const porCodigo = await bcIvaDeLineasOrden(orden.bcNumber);
        if (porCodigo && Object.keys(porCodigo).length) {
          alineadas = (await aplicarIvaDeBcEnOrden(id, porCodigo, a.usuario, a.rol)).cambiadas;
        }
      } catch (e: any) {
        avisoAlineado = `El pedido quedó exento en BC, pero no se pudo copiar ese IVA a las líneas de la orden (${String(e?.message ?? e)}). Usá “Usar el IVA de BC”.`;
      }
      return NextResponse.json({
        ordenNo, grupo: r.grupo, cambiadas: r.cambiadas, yaEstaban: r.yaEstaban,
        ivaAntes: r.ivaAntes, ivaDespues: r.ivaDespues, totalDespues: r.totalDespues, moneda: r.moneda,
        alineadas, aviso: [r.aviso, avisoAlineado].filter(Boolean).join(" ") || undefined,
      });
    }

    const porCodigo = await bcIvaDeLineasOrden(orden.bcNumber);
    if (!porCodigo || !Object.keys(porCodigo).length) {
      return NextResponse.json({
        error: `No se pudo leer el IVA de las líneas del pedido ${orden.bcNumber} en Business Central. Reintentá; si sigue, revisá que el pedido exista allá.`,
      }, { status: 502 });
    }
    const r = await aplicarIvaDeBcEnOrden(id, porCodigo, a.usuario, a.rol);
    return NextResponse.json(r);
  } catch (e: any) {
    const msg = String(e?.message ?? e);
    // "ya está lanzado" y "no tiene líneas" son estados del negocio, no fallas: 409
    // para que la pantalla los muestre tal cual en vez de "algo salió mal".
    const negocio = /no encontrada|no existe|lanzado|no tiene líneas/i.test(msg);
    return NextResponse.json({ error: msg }, { status: negocio ? 409 : 500 });
  }
}
