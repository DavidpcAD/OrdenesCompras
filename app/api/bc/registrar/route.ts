import { NextResponse } from "next/server";
import { bcRegistrarFactura } from "@/lib/bc";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Registra (Recibir + Facturar) una factura parcial del pedido en Business Central.
// body: { orderNo, vendorInvoiceNo, lineas: [{itemNo, qty}], postingDate? }
export async function POST(req: Request) {
  try {
    const { orderNo, vendorInvoiceNo, lineas, postingDate } = await req.json();
    const postedNo = await bcRegistrarFactura(orderNo, vendorInvoiceNo, lineas ?? [], postingDate ?? "");
    return NextResponse.json({ ok: true, postedNo });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: String(e?.message ?? e) }, { status: 502 });
  }
}
