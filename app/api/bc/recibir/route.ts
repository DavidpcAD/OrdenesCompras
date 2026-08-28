import { NextResponse } from "next/server";
import { bcRecibir, diagnosticarFalloBc } from "@/lib/bc";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// MODO 2 — Solo recepción en BC (material bien, factura en revisión).
// body: { orderNo, lineas: [{itemNo, qty}], postingDate? }
//
// Mismo diagnóstico que /api/bc/registrar: acá no hay N.º de factura, así que lo
// único que se puede separar es "reintentá" de "BC no tiene el pedido" — pero esa
// sola ya evita mandar a Bodega a reintentar contra una pared.
export async function POST(req: Request) {
  const cuerpo = await req.json().catch(() => ({} as any));
  const { orderNo, lineas, postingDate } = cuerpo ?? {};
  try {
    const receiptNo = await bcRecibir(orderNo, lineas ?? [], postingDate ?? "");
    return NextResponse.json({ ok: true, receiptNo });
  } catch (e: any) {
    const error = String(e?.message ?? e);
    const diag = await diagnosticarFalloBc(error, String(orderNo ?? "")).catch(() => null);
    return NextResponse.json({ ok: false, error, ...(diag ?? {}) }, { status: 502 });
  }
}
