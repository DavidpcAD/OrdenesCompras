import { NextResponse } from "next/server";
import { getOrden } from "@/lib/repo";
import { bcVaciarLineasPedido } from "@/lib/bc";
import { chequearOrdenPorId } from "@/lib/chequeo-orden";
import { actor } from "@/lib/actor";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// POST /api/ordenes/123/vaciar-bc
//
// Vaciar el pedido en Business Central de una orden que se quedó SIN MATERIAL porque
// todo volvió al ingeniero. Los dos lados tienen que decir lo mismo: si allá el pedido
// conserva las líneas viejas, cualquiera lo puede recibir o lanzar y estaría recibiendo
// material que esta app ya devolvió.
//
// Desde hoy la devolución lo vacía sola; esto existe para las órdenes que quedaron
// descuadradas ANTES (CP-005294 y las que vengan de un BC caído en ese momento), y como
// reintento cuando BC no contestó. Solo funciona en ese estado exacto: una orden con
// material NO se vacía por acá — para eso está guardar la edición, que le reescribe a
// BC lo que la orden dice.
export async function POST(_req: Request, { params }: { params: { id: string } }) {
  try {
    const id = Number(params.id);
    const a = await actor({}).catch(() => ({ usuario: "sistema", rol: "proveeduria" as const }));
    const o = await getOrden(id);
    if (!o) return NextResponse.json({ error: "Orden no encontrada." }, { status: 404 });
    if (!o.bcNumber) {
      return NextResponse.json({ error: "Esta orden no tiene pedido en Business Central: no hay nada que vaciar." }, { status: 409 });
    }
    if (o.lineas.some((l) => l.tipo === "articulo")) {
      return NextResponse.json({
        error: "Esta orden TIENE material, así que vaciar su pedido en Business Central borraría lo que sí está ordenado. Si BC quedó distinto, guardá la orden de nuevo: al guardar se le reescriben las líneas tal como está acá.",
      }, { status: 409 });
    }
    if (o.lineas.some((l) => l.cantidadRecibida > 0 || l.cantidadFacturada > 0)) {
      return NextResponse.json({ error: "La orden tiene material recibido o facturado: su pedido en BC no se vacía." }, { status: 409 });
    }

    const r = await bcVaciarLineasPedido(o.bcNumber);
    // Se relee BC y se guarda el cotejo: el aviso rojo tiene que apagarse porque los
    // dos lados ya dicen lo mismo, no porque alguien lo cerró.
    const ch = await chequearOrdenPorId(id, { persistir: true, usuario: a.usuario, rol: a.rol }).catch(() => null);
    return NextResponse.json({ ok: true, resultado: r.resultado, chequeo: ch?.resultado });
  } catch (e: any) {
    const msg = String(e?.message ?? e);
    return NextResponse.json({ error: `No se pudo vaciar el pedido en Business Central: ${msg}` }, { status: 502 });
  }
}
