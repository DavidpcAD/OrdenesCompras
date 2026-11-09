import { NextRequest, NextResponse } from "next/server";
import { exigirSesion } from "@/lib/actor";
import { comprobanteDeNumero, type ComprobanteDeFactura } from "@/lib/enlace-factura";
import { cedulaDeProveedorBc, comprobantesPorCola, tablaCorreoExiste } from "@/lib/repo-facturas-correo";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// GET /api/vigilancia/comprobante?numero=<N.º de factura>&proveedorNo=<PROV-…>&proveedor=<nombre>
//
// EL COMPROBANTE DEL CORREO QUE CORRESPONDE A LA FACTURA QUE SE ESTÁ DIGITANDO.
//
// Lo pidió Contabilidad (nov 2026): en Registrar factura puso una fecha que no era la
// de la factura y la pantalla le dijo "Coincide con la fecha de factura ✓". Decía la
// verdad —las dos fechas que tecleó eran iguales— pero no la que se esperaba. La
// fecha de emisión real está en el XML que el proveedor mandó al buzón, y la Auditoría
// ya lo leyó: acá solo se busca.
//
// Es de LECTURA y la usa también Bodega (lib/autorizacion.ts solo cierra las
// escrituras de /api/vigilancia). Si no encuentra nada, o encuentra dos, contesta
// `comprobante: null` y la pantalla no dice nada: adivinar una fecha es peor que callar.

export async function GET(req: NextRequest) {
  const sinSesion = await exigirSesion();
  if (sinSesion) return sinSesion;
  try {
    const sp = req.nextUrl.searchParams;
    const numero = (sp.get("numero") ?? "").trim();
    const nombre = (sp.get("proveedor") ?? "").trim();
    const codigo = (sp.get("proveedorNo") ?? "").trim();
    if (!numero || !(await tablaCorreoExiste())) return NextResponse.json({ comprobante: null });

    const [filas, cedula] = await Promise.all([
      comprobantesPorCola(numero),
      cedulaDeProveedorBc(codigo).catch(() => null),
    ]);
    const c = comprobanteDeNumero(filas, numero, { nombre, cedula });
    const comprobante: ComprobanteDeFactura | null = c
      ? { consecutivo: c.consecutivo, fechaEmision: c.fechaEmision, total: c.total, moneda: c.moneda, nombreEmisor: c.nombreEmisor }
      : null;
    return NextResponse.json({ comprobante });
  } catch (e: any) {
    // Es una ayuda, no un requisito para registrar: si falla, la pantalla sigue igual.
    console.error("vigilancia/comprobante GET:", e?.message ?? e);
    return NextResponse.json({ comprobante: null, error: "No se pudo buscar el comprobante en el correo." }, { status: 500 });
  }
}
