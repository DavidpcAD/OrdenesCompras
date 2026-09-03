import { NextResponse } from "next/server";
import { retomarOrdenDescartada } from "@/lib/repo";
import { bcEstadoDelPedido } from "@/lib/bc";
import { actor } from "@/lib/actor";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// RETOMAR la orden de la que salió un material devuelto, cuando esa orden se había
// descartado. Es el caso de las devoluciones anteriores al arreglo: devolver TODO el
// material marcaba la orden como eliminada aunque su pedido siguiera en Business
// Central, y entonces el material corregido solo podía ir a una orden NUEVA — o sea a
// un segundo pedido en BC por lo mismo.
//
// Solo revive la orden (que en SQL nunca se borró de verdad). El material corregido se
// le agrega después, desde la pantalla de edición.
export async function POST(req: Request) {
  try {
    const body = await req.json().catch(() => ({}));
    const ref = String((body as { orden?: string })?.orden ?? "").trim();
    if (!ref) return NextResponse.json({ error: "Decí qué orden retomar." }, { status: 400 });
    const a = await actor(body);
    const r = await retomarOrdenDescartada(ref, a.usuario, a.rol);

    // El sentido de retomarla es reusar SU pedido de BC: si allá ya no está, hay que
    // decirlo (la orden queda apuntando a un número muerto y lo que corresponde es
    // "Corregir N.º de BC" o armar otra). No se frena por no poder leer BC: eso es un
    // hecho sobre la red, no sobre el pedido.
    let bcAviso: string | undefined;
    if (r.bcNo) {
      try {
        const est = await bcEstadoDelPedido(r.bcNo);
        if (est === "no-existe") {
          bcAviso = `OJO: el pedido ${r.bcNo} ya NO existe en Business Central (lo borraron allá). La orden volvió, pero apunta a un número muerto: corregile el N.º de BC o armá una orden nueva con este material.`;
        }
      } catch { /* BC no contestó: la orden ya volvió, el aviso no es un hecho */ }
    }
    return NextResponse.json({ ...r, bcAviso });
  } catch (e: any) {
    const msg = String(e?.message ?? e);
    const negocio = /No hay ninguna orden|nunca llegó a Business Central|recepciones|No se dijo/i.test(msg);
    return NextResponse.json({ error: msg }, { status: negocio ? 409 : 500 });
  }
}
