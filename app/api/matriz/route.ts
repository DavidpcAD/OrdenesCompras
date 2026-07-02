import { NextResponse } from "next/server";
import { listWbs, listObras, matrizCeldas } from "@/lib/repo";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Matriz por obra: obras (filas) + WBS (columnas = sub_partidas) + celdas con estado.
export async function GET() {
  try {
    const [wbs, obras, celdas] = await Promise.all([listWbs(), listObras(), matrizCeldas()]);
    return NextResponse.json({ ...wbs, obras, celdas });
  } catch (e: any) {
    return NextResponse.json({ error: String(e?.message ?? e) }, { status: 500 });
  }
}
