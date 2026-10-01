import { NextRequest, NextResponse } from "next/server";
import { etapasDeUsuario } from "@/lib/repo";
import { mensajeSeguro } from "@/lib/error-sql";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// GET /api/mi-etapa?username=laura → { etapaIds: number[] }
// Etapas (especialidad) del ingeniero, para que la Matriz arranque en las suyas.
// Nunca 500: si SQL falla o no hay mapeo, devuelve lista vacía.
export async function GET(req: NextRequest) {
  const username = new URL(req.url).searchParams.get("username") ?? "";
  try {
    return NextResponse.json({ etapaIds: await etapasDeUsuario(username) });
  } catch (e: any) {
    return NextResponse.json({ etapaIds: [], error: mensajeSeguro(e) });
  }
}
