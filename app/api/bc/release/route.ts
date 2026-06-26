import { NextResponse } from "next/server";
import { bcReleasePedido } from "@/lib/bc";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Lanza (Release) en BC un Pedido de compra YA CREADO, por su número (orderNo).
// Se usa para reintentar el lanzamiento cuando el pedido se creó pero el release
// falló (p.ej. el binding S2S del Sandbox parpadeó). No crea nada nuevo.
export async function POST(req: Request) {
  try {
    const { orderNo } = await req.json();
    if (!orderNo) return NextResponse.json({ error: "Falta orderNo" }, { status: 400 });
    const status = await bcReleasePedido(orderNo);
    return NextResponse.json({ ok: true, status });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: String(e?.message ?? e) }, { status: 502 });
  }
}
