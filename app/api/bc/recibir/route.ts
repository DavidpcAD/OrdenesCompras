import { NextResponse } from "next/server";
import { bcRecibir } from "@/lib/bc";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// MODO 2 — Solo recepción en BC (material bien, factura en revisión).
// body: { orderNo, lineas: [{itemNo, qty}] }
export async function POST(req: Request) {
  try {
    const { orderNo, lineas } = await req.json();
    const receiptNo = await bcRecibir(orderNo, lineas ?? []);
    return NextResponse.json({ ok: true, receiptNo });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: String(e?.message ?? e) }, { status: 502 });
  }
}
