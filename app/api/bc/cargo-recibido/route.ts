import { NextRequest, NextResponse } from "next/server";
import { bcPostChargeOnReceipts } from "@/lib/bc";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// POST /api/bc/cargo-recibido
// Registra en BC un Cargo de producto (flete/transporte facturado por un tercero)
// sobre líneas de recepciones ya registradas: crea el pedido con solo la línea de
// cargo, lo asigna a las líneas de recepción elegidas con el método indicado, fija
// el N.º de factura del proveedor y registra. Body: ver bcPostChargeOnReceipts.
export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const resultado = await bcPostChargeOnReceipts(body);
    return NextResponse.json({ ok: true, resultado });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: String(e?.message ?? e) }, { status: 400 });
  }
}
