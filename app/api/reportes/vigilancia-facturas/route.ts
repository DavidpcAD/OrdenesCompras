import { NextRequest, NextResponse } from "next/server";
import { bcFacturasCompra, bcProveedoresConCedula } from "@/lib/bc";
import {
  borradoresSinRegistrar, posiblesDobles, proveedoresCallados,
  proveedoresSinCedula, fichasDuplicadas,
} from "@/lib/vigilancia-facturas";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// GET /api/reportes/vigilancia-facturas?desde=2025-10-01
//
// LA FASE 0 DE LA VIGILANCIA. Lo que se puede vigilar HOY, sin leer el correo.
//
// La vigilancia de verdad —qué factura llegó al buzón y no está en BC— necesita leer
// los XML del correo, y eso necesita un registro de app en Entra que todavía no
// existe. Pero de BC solo ya salen tres preguntas con respuesta, y las tres
// encontraron plata real en la revisión del 22 de setiembre de 2026: 31 facturas en
// borrador que nunca se registraron (₡7,5 millones) y 15 pares con pinta de doble
// registro (₡9,2 millones).
//
// Son DOS llamadas a BC y el cruce se hace acá en memoria. Se traen las listas
// completas porque las señales son de conjunto: "este proveedor se calló" no se
// contesta mirando una factura. Con el año y medio que existe en BC son ~10.400
// facturas y ~800 proveedores, que viajan en unos pocos segundos.

const DESDE_POR_DEFECTO = "2025-11-01";   // la primera factura de compra que existe en BC

export async function GET(req: NextRequest) {
  try {
    const sp = req.nextUrl.searchParams;
    const desde = /^\d{4}-\d{2}-\d{2}$/.test(sp.get("desde") ?? "")
      ? (sp.get("desde") as string)
      : DESDE_POR_DEFECTO;
    const hoy = new Date().toISOString().slice(0, 10);

    const [facturas, proveedores] = await Promise.all([
      bcFacturasCompra(desde),
      bcProveedoresConCedula(),
    ]);

    const borradores = borradoresSinRegistrar(facturas);
    const dobles = posiblesDobles(facturas);
    const callados = proveedoresCallados(facturas, hoy);
    const sinCedula = proveedoresSinCedula(facturas, proveedores);
    const duplicadas = fichasDuplicadas(proveedores, facturas);

    // Los totales se suman SOLO en colones. Mezclar monedas en un total daría un
    // número que no significa nada, y en BC conviven CRC, USD y EUR.
    const enColones = (xs: { total: number; moneda: string }[]) =>
      xs.filter((x) => x.moneda === "CRC").reduce((s, x) => s + x.total, 0);

    return NextResponse.json({
      desde,
      hoy,
      revisadas: facturas.length,
      proveedores: proveedores.length,
      borradores: {
        n: borradores.length,
        montoCRC: enColones(borradores),
        filas: borradores,
      },
      dobles: {
        n: dobles.length,
        montoCRC: enColones(dobles.map((p) => p.a)),
        filas: dobles,
      },
      callados: { n: callados.length, filas: callados },
      sinCedula: {
        n: sinCedula.length,
        // Lo que de verdad mide el hueco no es cuántas fichas están incompletas sino
        // cuántas facturas quedan sin llave de cruce por culpa de ellas.
        facturasAfectadas: sinCedula.reduce((s, p) => s + p.facturas, 0),
        filas: sinCedula,
      },
      duplicadas: { n: duplicadas.length, filas: duplicadas },
    });
  } catch (e: any) {
    console.error("vigilancia-facturas:", e?.message ?? e);
    return NextResponse.json(
      { error: `No se pudo leer Business Central: ${e?.message ?? "error desconocido"}` },
      { status: 502 },
    );
  }
}
