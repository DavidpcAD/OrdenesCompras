import { NextRequest, NextResponse } from "next/server";
import { listOrdenes, listRecepciones } from "@/lib/repo";
import { bcFacturasRegistradasDelPeriodo, bcQuienRegistro } from "@/lib/bc";
import { cruzarFacturasDeBc, resumirBarrido } from "@/lib/barrido-bc";
import { mensajeSeguro } from "@/lib/error-sql";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// GET /api/reportes/barrido-bc?desde=2026-08-01&hasta=2026-09-30
//
// EL BARRIDO DE UNA SOLA PREGUNTA. Conciliación BC va orden por orden (una o dos
// llamadas a BC por cada una) y por eso barrer las 657 órdenes que viven en BC son
// tandas y minutos. Este endpoint hace la pregunta al revés —"BC, dame TODAS las
// facturas que registraste desde tal fecha"— y cruza acá adentro: una consulta,
// segundos, y encuentra lo que nadie estaba mirando.
//
// Lo que encuentra: pedidos que BC ya facturó y que en la app siguen sin recepción.
// El 30 de setiembre de 2026, corrido a mano por primera vez, sacó 70 órdenes por
// ₡41,4 millones. Ver lib/barrido-bc.ts para la historia completa y la distinción
// entre "lo posteó la app y no lo guardó" y "lo registró una persona en BC".
export async function GET(req: NextRequest) {
  try {
    const sp = req.nextUrl.searchParams;
    const desde = (sp.get("desde") ?? "").trim() || haceTresMeses();
    const hasta = (sp.get("hasta") ?? "").trim();

    const [ordenes, recepciones, facturas] = await Promise.all([
      listOrdenes(),
      listRecepciones(),
      bcFacturasRegistradasDelPeriodo(desde, hasta || undefined),
    ]);

    // Dos pasadas por el cruce, a propósito. La primera dice CUÁLES faltan; solo
    // para esas se le pregunta a BC quién las registró (es una consulta aparte, a
    // otra tabla, y pedirla para las 4.744 del año sería regalarle trabajo a BC).
    // La segunda pasada es puro cálculo en memoria: no cuesta nada.
    const previo = cruzarFacturasDeBc(ordenes, recepciones, facturas);
    const quien = await bcQuienRegistro(previo.flatMap((f) => f.faltantes.map((x) => x.numero)));
    const filas = cruzarFacturasDeBc(ordenes, recepciones, facturas, quien);

    return NextResponse.json({
      desde, hasta: hasta || null,
      facturasEnBc: facturas.length,
      ordenesRevisadas: ordenes.filter((o) => !!o.bcNumber).length,
      resumen: resumirBarrido(filas),
      filas,
    });
  } catch (e: any) {
    return NextResponse.json({ error: mensajeSeguro(e) }, { status: 500 });
  }
}

function haceTresMeses(): string {
  const d = new Date();
  d.setMonth(d.getMonth() - 3);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
