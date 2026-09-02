import { NextResponse } from "next/server";
import { bcFacturarRecibido, verificarLineasPosteables, frenoRegistroActivo } from "@/lib/bc";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// MODO 2 — Registrar la factura de lo YA recibido (Kattya, tras revisar).
// body: { orderNo, vendorInvoiceNo, lineas: [{itemNo, qty}] }
export async function POST(req: Request) {
  try {
    const { orderNo, vendorInvoiceNo, lineas } = await req.json();
    // Acá el saldo que importa es lo RECIBIDO SIN FACTURAR: el codeunit filtra por
    // "Qty. Rcd. Not Invoiced" y, si no calza, se salta la línea sin decir nada.
    // BC_FRENO_REGISTRO=0 lo apaga desde Azure: si el chequeo diera un falso
    // positivo, Bodega no podría recibir un camión y no se puede esperar un despliegue.
    const freno = frenoRegistroActivo()
      ? await verificarLineasPosteables(String(orderNo ?? ""), lineas ?? [], "facturar-recibido")
      : { ok: true, problemas: [] as string[], verificado: false };
    if (!freno.ok) {
      return NextResponse.json({
        ok: false,
        error: `NO se facturó: Business Central no puede facturar ${freno.problemas.length} línea(s).\n\n`
          + freno.problemas.map((p) => `• ${p}`).join("\n")
          + `\n\nRevisá el pedido ${orderNo} en BC antes de reintentar.`,
        frenoLineas: true,
        problemas: freno.problemas,
      }, { status: 409 });
    }
    const postedNo = await bcFacturarRecibido(orderNo, vendorInvoiceNo, lineas ?? []);
    return NextResponse.json({ ok: true, postedNo });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: String(e?.message ?? e) }, { status: 502 });
  }
}
