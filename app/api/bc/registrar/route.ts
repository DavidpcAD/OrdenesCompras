import { NextResponse } from "next/server";
import { bcRegistrarFactura } from "@/lib/bc";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Registra (Recibir + Facturar) una factura parcial del pedido en Business Central.
// body: { orderNo, vendorInvoiceNo, lineas: [{itemNo, qty}], postingDate?,
//         cargo?: { itemChargeNo, descripcion?, monto, metodo? } }  ← flete del viaje
export async function POST(req: Request) {
  try {
    const { orderNo, vendorInvoiceNo, lineas, postingDate, cargo } = await req.json();
    const cargoValido = cargo && cargo.itemChargeNo && Number(cargo.monto) > 0
      ? { itemChargeNo: String(cargo.itemChargeNo), descripcion: cargo.descripcion ? String(cargo.descripcion) : undefined, monto: Number(cargo.monto), metodo: cargo.metodo ? String(cargo.metodo) : undefined }
      : undefined;
    const postedNo = await bcRegistrarFactura(orderNo, vendorInvoiceNo, lineas ?? [], postingDate ?? "", cargoValido);
    return NextResponse.json({ ok: true, postedNo });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: String(e?.message ?? e) }, { status: 502 });
  }
}
