import { NextRequest, NextResponse } from "next/server";
import { bcItems, bcItemsPagina } from "@/lib/bc";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// GET /api/bc/items                     → catálogo COMPLETO (con costo y categoría).
// GET /api/bc/items?top=250&skip=0      → UNA página, para pintar por bloques.
//
// La versión paginada existe para Inventarios: el catálogo tiene 5000+ artículos y
// esperar todo antes de dibujar la primera fila se sentía como una pantalla colgada.
export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const top = Number(searchParams.get("top") ?? 0);
  const skip = Math.max(0, Number(searchParams.get("skip") ?? 0));
  try {
    if (top > 0) {
      try {
        const p = await bcItemsPagina(Math.min(top, 1000), skip);
        return NextResponse.json({ items: p.items, hayMas: p.hayMas, paginado: true });
      } catch (e) {
        // Si la API custom no acepta $top/$skip, no se rompe la pantalla: se
        // devuelve el catálogo completo de una vez (se pierde el pintado por
        // bloques, no los datos). En páginas siguientes ya no hay nada que traer.
        console.warn("BC items paginado falló; cayendo al catálogo completo:", e);
        if (skip > 0) return NextResponse.json({ items: [], hayMas: false, paginado: false });
        return NextResponse.json({ items: await bcItems(), hayMas: false, paginado: false });
      }
    }
    return NextResponse.json({ items: await bcItems() });
  } catch (e: any) {
    return NextResponse.json({ error: String(e?.message ?? e) }, { status: 500 });
  }
}
