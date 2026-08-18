import { NextResponse } from "next/server";
import { getOrden, setOrdenEstado, updateOrden, ordenTieneRecepciones, MSG_NO_REABRIR } from "@/lib/repo";
import { bcReopenPedido } from "@/lib/bc";
import { actor } from "@/lib/actor";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(_req: Request, { params }: { params: { id: string } }) {
  try {
    const o = await getOrden(Number(params.id));
    if (!o) return NextResponse.json({ error: "no encontrada" }, { status: 404 });
    return NextResponse.json(o);
  } catch (e: any) {
    return NextResponse.json({ error: String(e?.message ?? e) }, { status: 500 });
  }
}

export async function PATCH(req: Request, { params }: { params: { id: string } }) {
  try {
    const body = await req.json();
    const { estado, motivo, bcNumber } = body;
    const a = await actor(body);   // identidad de la sesión, no del body
    const id = Number(params.id);

    // REABRIR: la orden vuelve a "Abierto" acá Y el pedido se des-lanza en BC. Si no,
    // en BC queda Lanzado y no se puede editar ni re-sincronizar antes de volver a
    // mandarla a aprobación.
    // - Con recepciones/facturas ya registradas NO se reabre nada (ni acá ni en BC).
    // - Si BC no puede reabrir (p.ej. el web service no está publicado), la orden SÍ
    //   se reabre acá y se devuelve `bcAviso` para que la pantalla lo diga; así el
    //   botón sigue sirviendo y no se pierde el trabajo.
    let bcAviso: string | undefined;
    if (estado === "abierto") {
      if (await ordenTieneRecepciones(id)) {
        return NextResponse.json({ error: MSG_NO_REABRIR }, { status: 409 });
      }
      const no = bcNumber || (await getOrden(id))?.bcNumber;
      if (no) {
        try { await bcReopenPedido(String(no)); }
        catch (e: any) { bcAviso = `Se reabrió acá, pero en BC el pedido ${no} sigue Lanzado — ${String(e?.message ?? e)}`; }
      }
    }

    await setOrdenEstado(id, estado, a.usuario, a.rol, motivo, bcNumber);
    return NextResponse.json({ ok: true, bcAviso });
  } catch (e: any) {
    return NextResponse.json({ error: String(e?.message ?? e) }, { status: 500 });
  }
}

export async function PUT(req: Request, { params }: { params: { id: string } }) {
  try {
    const body = await req.json();
    await updateOrden(Number(params.id), { ...body, ...(await actor(body)) });
    return NextResponse.json({ ok: true });
  } catch (e: any) {
    return NextResponse.json({ error: String(e?.message ?? e) }, { status: 500 });
  }
}
