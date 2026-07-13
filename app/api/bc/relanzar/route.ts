import { NextResponse } from "next/server";
import { bcResyncPedidoLines, bcReleasePedido } from "@/lib/bc";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Re-sincroniza (precio + variante) las líneas de un pedido YA creado en BC y luego
// lo lanza. Se usa al REINTENTAR "Aprobar y lanzar": si la orden se corrigió en la
// app después de crearse en BC, esas correcciones viajan a BC antes del release.
export async function POST(req: Request) {
  try {
    const { orderNo, lineas } = await req.json();
    if (!orderNo) return NextResponse.json({ error: "Falta orderNo" }, { status: 400 });
    if (Array.isArray(lineas) && lineas.length) {
      await bcResyncPedidoLines(orderNo, lineas);
    }
    const status = await bcReleasePedido(orderNo);
    return NextResponse.json({ ok: true, status });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: String(e?.message ?? e) }, { status: 502 });
  }
}
