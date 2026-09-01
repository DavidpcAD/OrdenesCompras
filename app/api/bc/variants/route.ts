import { NextResponse } from "next/server";
import { bcVariantsEx, bcVariantesDeItems } from "@/lib/bc";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Variantes de un material en BC (el grado de la varilla, la talla del zapato).
//
//   ?item=M12-0014          → { variantes, disponible }   (un ítem, para un selector)
//   ?items=M12-0014,M16-… → { porItem, disponible }     (varios, para una tabla)
//
// La forma en LOTE existe porque las pantallas que muestran la variante tienen
// decenas de líneas: una llamada por ítem eran decenas de idas a BC por pantalla.
export async function GET(req: Request) {
  const q = new URL(req.url).searchParams;
  const item = q.get("item") ?? "";
  const items = (q.get("items") ?? "").split(",").map((s) => s.trim()).filter(Boolean);
  try {
    if (items.length) {
      const { porItem, disponible } = await bcVariantesDeItems(items);
      return NextResponse.json({ porItem, disponible });
    }
    const { variantes, disponible } = await bcVariantsEx(item);
    return NextResponse.json({ variantes, disponible });
  } catch (e: any) {
    return NextResponse.json({ error: String(e?.message ?? e) }, { status: 500 });
  }
}
