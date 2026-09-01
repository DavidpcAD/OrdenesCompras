import { NextResponse } from "next/server";
import { aplicarIvaDeBcEnOrden, getOrden } from "@/lib/repo";
import { bcIvaDeLineasOrden } from "@/lib/bc";
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
// exterior donde el impuesto de aduana ya va en su línea de cargo), se corrige allá el
// grupo de IVA y se vuelve a llamar acá.
export async function POST(req: Request, { params }: { params: { id: string } }) {
  try {
    const body = await req.json().catch(() => ({}));
    const a = await actor(body);
    const id = Number(params.id);
    const orden = await getOrden(id);
    if (!orden) return NextResponse.json({ error: "Orden no encontrada." }, { status: 404 });
    if (!orden.bcNumber) {
      return NextResponse.json({
        error: "Esta orden todavía no existe en Business Central, así que no hay IVA de allá que copiar. Se crea al enviarla a aprobación.",
      }, { status: 409 });
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
    const negocio = /no encontrada|no existe/i.test(msg);
    return NextResponse.json({ error: msg }, { status: negocio ? 409 : 500 });
  }
}
