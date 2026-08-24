import { NextRequest, NextResponse } from "next/server";
import { bcDescripcionUnidades, bcUnidadesDeItem, bcUnidadesDeCompra } from "@/lib/bc";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// GET /api/bc/unidades              → descripción de cada unidad de BC:
//     { EST: "ESTAÑON", GR: "Gramos", … }. Son ~34 filas. La usa la vista de
//     impresión para mostrar lo MISMO que el PDF del servidor: el proveedor lee
//     "ESTAÑON", no "EST".
//
// GET /api/bc/unidades?item=M06-0009 → las unidades de ESE material, con cuántas
//     unidades base trae cada una, más cuál es la base y cuál la de compra
//     habitual. Es la lista que se ve en BC en "Unidades medida producto"
//     (GR 1, EST 255.000, LT 244,01914…), para poder elegir con cuál se le pide
//     al proveedor en vez de que la app imponga una.
export async function GET(req: NextRequest) {
  const item = (new URL(req.url).searchParams.get("item") ?? "").trim();
  if (!item) {
    try {
      return NextResponse.json({ unidades: await bcDescripcionUnidades() });
    } catch {
      return NextResponse.json({ unidades: {} });
    }
  }
  try {
    // Las descripciones y el mapa de unidades de compra están cacheados (5 min),
    // así que pedirlos por material no cuesta una vuelta a BC cada vez.
    const [unidades, desc, mapa] = await Promise.all([
      bcUnidadesDeItem(item),
      bcDescripcionUnidades().catch(() => ({} as Record<string, string>)),
      bcUnidadesDeCompra().catch(() => ({} as Awaited<ReturnType<typeof bcUnidadesDeCompra>>)),
    ]);
    const u = mapa[item];
    return NextResponse.json({
      unidades: unidades.map((x) => ({ ...x, descripcion: desc[x.code] ?? "" })),
      base: u?.base ?? "",
      compra: u?.compra ?? "",
    });
  } catch (e: any) {
    // Sin la página publicada en BC la lista viene vacía y la pantalla se queda
    // con la unidad de siempre: nunca se inventa una.
    return NextResponse.json({ unidades: [], base: "", compra: "", error: String(e?.message ?? e) });
  }
}
