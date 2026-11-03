import { NextResponse } from "next/server";
import { exigirSesion } from "@/lib/actor";
import { bcRecursos } from "@/lib/bc";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// GET /api/bc/recursos → { recursos: [{ no, nombre, unidad, costo }] }
// Catálogo de Recursos (Resource, BC 156) para la línea de tipo "Recurso" de una
// compra directa. Nunca 500: si la API custom todavía no está publicada en este
// entorno, devuelve lista vacía y la pantalla no ofrece el tipo.
export async function GET() {
  const sinSesion = await exigirSesion();
  if (sinSesion) return sinSesion;
  try {
    return NextResponse.json({ recursos: await bcRecursos() });
  } catch (e: any) {
    return NextResponse.json({ recursos: [], error: String(e?.message ?? e) });
  }
}
