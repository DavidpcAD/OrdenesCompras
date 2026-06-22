import { NextResponse } from "next/server";
import { createPlantilla, listPlantillas } from "@/lib/repo";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    return NextResponse.json({ plantillas: await listPlantillas() });
  } catch (e: any) {
    return NextResponse.json({ error: String(e?.message ?? e) }, { status: 500 });
  }
}

export async function POST(req: Request) {
  try {
    const body = await req.json();
    if (!body?.nombre || !body?.creadoPor) {
      return NextResponse.json({ error: "Faltan nombre o creadoPor" }, { status: 400 });
    }
    const id = await createPlantilla({
      nombre: String(body.nombre),
      creadoPor: String(body.creadoPor),
      lineas: Array.isArray(body.lineas) ? body.lineas : [],
    });
    return NextResponse.json({ idPlantillaSolicitud: id }, { status: 201 });
  } catch (e: any) {
    return NextResponse.json({ error: String(e?.message ?? e) }, { status: 500 });
  }
}
