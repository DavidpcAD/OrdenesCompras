import { NextRequest, NextResponse } from "next/server";
import { bcFacturasConNumeroProveedor, bcPostChargeOnReceipts } from "@/lib/bc";
import { clasificarFacturasMismoNumero, detalleParaHistorial, importeDelCargo } from "@/lib/cargo-recibido";
import { createCargoRecibido } from "@/lib/repo";
import { actor } from "@/lib/actor";
import { mensajeSeguro } from "@/lib/error-sql";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// POST /api/bc/cargo-recibido
// Registra en BC un Cargo de producto (flete/transporte facturado por un tercero)
// sobre líneas de recepciones ya registradas: crea el pedido con solo la línea de
// cargo, lo asigna a las líneas de recepción elegidas con el método indicado, fija
// el N.º de factura del proveedor y registra. Body: ver bcPostChargeOnReceipts, más
// `chargeVendorNombre` y `detalleLineas` para el histórico.
//
// Después de registrar deja el HISTÓRICO (dbo.CargoRecibido): BC solo sabe que lo
// registró la app, y la app no guardaba nada. Si el histórico falla, el cargo igual
// quedó en BC: se contesta ok con `historialError` para que la pantalla lo diga.
export async function POST(req: NextRequest) {
  let body: any;
  try { body = await req.json(); } catch { return NextResponse.json({ ok: false, error: "El pedido vino vacío o mal armado." }, { status: 400 }); }

  // Qué borradores de ESTA factura había en BC antes de registrar: si nadie los
  // borra, la misma factura queda dos veces. No frena el registro (la pantalla ya
  // lo avisó); solo queda anotado en el histórico.
  let borradores: string[] = [];
  try {
    borradores = clasificarFacturasMismoNumero(await bcFacturasConNumeroProveedor(body?.chargeVendorNo, body?.vendorInvoiceNo))
      .borradores.map((b) => b.numero);
  } catch { /* BC no contestó esa consulta: el registro sigue igual */ }

  // Pago con tarjeta: SOLO Contabilidad. La UI solo se lo muestra a Contabilidad, pero
  // el gate de verdad está acá, por si llega un request armado a mano.
  if (body?.tarjeta) {
    const quien = await actor(body).catch(() => null);
    if (quien?.rol !== "contabilidad") body.tarjeta = undefined;
  }

  let resultado: string;
  try {
    resultado = await bcPostChargeOnReceipts(body);
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: String(e?.message ?? e) }, { status: 400 });
  }

  let historialError: string | undefined;
  try {
    const a = await actor(body);
    const enviadas = (Array.isArray(body.receiptLines) ? body.receiptLines : [])
      .filter((l: any) => l?.documentNo && Number(l.lineNo) > 0)
      .map((l: any) => ({ documentNo: String(l.documentNo), lineNo: Number(l.lineNo) }));
    const cantidad = Number(body.cantidad) > 0 ? Number(body.cantidad) : 1;
    await createCargoRecibido({
      facturaBc: String(resultado ?? ""),
      proveedorNo: String(body.chargeVendorNo ?? ""),
      proveedorNombre: body.chargeVendorNombre ? String(body.chargeVendorNombre) : undefined,
      facturaProveedor: String(body.vendorInvoiceNo ?? "").trim(),
      fechaFactura: body.documentDate ? String(body.documentDate) : undefined,
      moneda: String(body.currencyCode ?? ""),
      tipoCargo: String(body.itemChargeNo ?? body.chargeNo ?? ""),
      descripcionCargo: body.chargeDescription ? String(body.chargeDescription) : undefined,
      cantidad,
      precioUnitario: Number(body.precio) || 0,
      importe: importeDelCargo({ chargeAmount: body.chargeAmount, precio: Number(body.precio) || 0, cantidad }),
      metodo: String(body.metodo ?? "Amount"),
      borradores,
      lineas: detalleParaHistorial(enviadas, body.detalleLineas),
      usuario: a.usuario,
      rol: a.rol,
    });
  } catch (e) {
    console.error("cargo-recibido: se registró en BC pero no se guardó el histórico", e);
    historialError = mensajeSeguro(e);
  }
  return NextResponse.json({ ok: true, resultado, historialError });
}
