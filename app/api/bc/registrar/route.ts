import { NextResponse } from "next/server";
import { bcRegistrarFactura, diagnosticarFalloBc, verificarLineasPosteables, frenoRegistroActivo } from "@/lib/bc";
import { frenarPorEncabezado } from "@/lib/freno-encabezado";

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
  const { orderNo, vendorInvoiceNo, vendorNo, ordenId, lineas, postingDate, cargo } = cuerpo ?? {};
  try {
    // FRENO 1 — el ENCABEZADO del pedido en BC: que siga siendo del mismo proveedor
    // y que esté LANZADO allá. Va ANTES que el de líneas porque es lo más caro de
    // deshacer: una línea mal registrada se corrige, una factura cargada al proveedor
    // equivocado hay que anularla con nota de crédito. Ver lib/freno-encabezado.ts.
    const frenoProv = await frenarPorEncabezado(orderNo, ordenId, vendorNo, "registrar");
    if (frenoProv) return NextResponse.json(frenoProv, { status: 409 });
    // FRENO: antes de mover un peso, se comprueba que cada línea exista en el pedido
    // de BC con saldo suficiente. Los procedures del codeunit se saltan en silencio
    // la línea que no calzan (FindFirst sin else) y devuelven el N.º de la factura
    // igual, así que sin esto la app da por recibido lo que BC nunca registró.
    // BC_FRENO_REGISTRO=0 lo apaga desde Azure: si el chequeo diera un falso
    // positivo, Bodega no podría recibir un camión y no se puede esperar un despliegue.
    const freno = frenoRegistroActivo()
      ? await verificarLineasPosteables(String(orderNo ?? ""), lineas ?? [], "recibir")
      : { ok: true, problemas: [] as string[], verificado: false };
    if (!freno.ok) {
      return NextResponse.json({
        ok: false,
        error: `NO se registró: Business Central no puede recibir ${freno.problemas.length} de las líneas de esta factura.\n\n`
          + freno.problemas.map((p) => `• ${p}`).join("\n")
          + `\n\nCorregí el pedido ${orderNo} en BC (o la orden acá) y volvé a intentar. La orden queda por recibir.`,
        frenoLineas: true,
        problemas: freno.problemas,
      }, { status: 409 });
    }
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
