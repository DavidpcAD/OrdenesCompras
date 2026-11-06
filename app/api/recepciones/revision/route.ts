import { NextResponse } from "next/server";
import { exigirSesion } from "@/lib/actor";
import { listEnviosARevision, listFacturadasDesdeRevision } from "@/lib/repo";
import { mensajeSeguro } from "@/lib/error-sql";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// GET /api/recepciones/revision
// Lo que la pantalla de Archivo necesita de "Facturas en revisión" y que no viene en
// el bootstrap, porque sale de la bitácora:
//   · envios     → quién mandó cada recepción a revisión, cuándo, con qué N.º de
//                  factura y por qué (lo que escribió Bodega al confirmar);
//   · registradas → el histórico: a cuáles ya se les registró la factura, quién y cuándo.
export async function GET() {
  const sinSesion = await exigirSesion();
  if (sinSesion) return sinSesion;
  try {
    const [envios, registradas] = await Promise.all([listEnviosARevision(), listFacturadasDesdeRevision()]);
    return NextResponse.json({ envios, registradas });
  } catch (e: any) {
    return NextResponse.json({ error: mensajeSeguro(e) }, { status: 500 });
  }
}
