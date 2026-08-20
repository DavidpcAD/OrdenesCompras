import { NextRequest, NextResponse } from "next/server";
import { obrasDeUsuario } from "@/lib/repo";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// GET /api/mis-obras?username=anabg
//   → { obras: [{ idObra, numeroObra, nombreMostrado }], patrones: ["INF-%"] }
//
// Obras por las que arranca la Matriz de ese ingeniero. Hermano de /api/mi-etapa:
// unos filtran por fase (etapa) y otros por obra. Nunca 500 y nunca inventa: si no
// hay mapeo, o los patrones no calzan con ninguna obra, devuelve la lista vacía y la
// Matriz muestra todo.
export async function GET(req: NextRequest) {
  const username = new URL(req.url).searchParams.get("username") ?? "";
  try {
    return NextResponse.json(await obrasDeUsuario(username));
  } catch (e: any) {
    return NextResponse.json({ obras: [], patrones: [], error: String(e?.message ?? e) });
  }
}
