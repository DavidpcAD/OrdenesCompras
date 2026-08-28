import { NextResponse } from "next/server";
import { bcRegistrarFactura, diagnosticarFalloBc } from "@/lib/bc";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Registra (Recibir + Facturar) una factura parcial del pedido en Business Central.
// body: { orderNo, vendorInvoiceNo, vendorNo?, lineas: [{itemNo, qty}], postingDate?,
//         cargo?: { itemChargeNo, descripcion?, monto, metodo? } }  ← flete del viaje
//
// Cuando BC dice NO, la respuesta no se queda en el texto crudo: se DIAGNOSTICA
// (ver diagnosticarFalloBc). La diferencia importa porque la pantalla mandaba a
// reintentar siempre, y hay dos "no" contra los que reintentar no sirve nunca —
// la factura ya registrada en BC y el pedido que ya no existe allá porque se
// completó. `vendorNo` es opcional: solo sirve para ENCONTRAR esa factura en BC
// y mostrarle a Bodega cuál es.
export async function POST(req: Request) {
  const cuerpo = await req.json().catch(() => ({} as any));
  const { orderNo, vendorInvoiceNo, vendorNo, lineas, postingDate, cargo } = cuerpo ?? {};
  try {
    const cargoValido = cargo && cargo.itemChargeNo && Number(cargo.monto) > 0
      ? { itemChargeNo: String(cargo.itemChargeNo), descripcion: cargo.descripcion ? String(cargo.descripcion) : undefined, monto: Number(cargo.monto), metodo: cargo.metodo ? String(cargo.metodo) : undefined }
      : undefined;
    const postedNo = await bcRegistrarFactura(orderNo, vendorInvoiceNo, lineas ?? [], postingDate ?? "", cargoValido);
    return NextResponse.json({ ok: true, postedNo });
  } catch (e: any) {
    const error = String(e?.message ?? e);
    // El diagnóstico habla con BC otra vez: si eso también falla, se responde el
    // error de siempre (nunca se pierde el motivo original por sondear).
    const diag = await diagnosticarFalloBc(error, String(orderNo ?? ""), String(vendorInvoiceNo ?? ""), String(vendorNo ?? ""))
      .catch(() => null);
    return NextResponse.json({ ok: false, error, ...(diag ?? {}) }, { status: 502 });
  }
}
