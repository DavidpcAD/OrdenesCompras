import { NextResponse } from "next/server";
import { bcFormasDePagoTarjeta, bcDimensionesEncabezado, bcValoresDeDimension } from "@/lib/bc";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Opciones para el flujo de "pago con tarjeta" de Amazon (ver app/facturacion/[id]).
//   GET           → { formas, dimensiones, dimDefault, valores }  (valores = los del dimDefault)
//   GET ?dim=CC   → { valores }  (los valores de ESA dimensión, para el select en cascada)
//
// Las tres lecturas van a la API estándar de BC y están cacheadas en lib/bc.ts: cambian
// muy de vez en cuando (tarjetas y dimensiones del catálogo), así que no vale pegarle a
// BC en cada apertura de la pantalla.
export async function GET(req: Request) {
  const dim = new URL(req.url).searchParams.get("dim");
  try {
    if (dim) {
      return NextResponse.json({ valores: await bcValoresDeDimension(dim) });
    }
    const dimDefault = (process.env.BC_TARJETA_DIM_DEFAULT ?? "TM").trim();
    const [formas, dimensiones, valores] = await Promise.all([
      bcFormasDePagoTarjeta(),
      bcDimensionesEncabezado(),
      bcValoresDeDimension(dimDefault).catch(() => []),
    ]);
    return NextResponse.json({ formas, dimensiones, dimDefault, valores });
  } catch (e: any) {
    return NextResponse.json({ error: String(e?.message ?? e) }, { status: 502 });
  }
}
