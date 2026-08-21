import { NextResponse } from "next/server";
import { bcDescripcionUnidades } from "@/lib/bc";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Descripción de cada unidad de medida de BC: { EST: "ESTAÑON", GR: "Gramos", … }.
// Son ~34 filas. La usa la vista de impresión para mostrar lo MISMO que el PDF del
// servidor: el proveedor lee "ESTAÑON", no "EST".
export async function GET() {
  try {
    return NextResponse.json({ unidades: await bcDescripcionUnidades() });
  } catch {
    return NextResponse.json({ unidades: {} });
  }
}
