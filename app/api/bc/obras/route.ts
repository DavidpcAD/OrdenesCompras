import { NextResponse } from "next/server";
import { exigirSesion } from "@/lib/actor";
import { bcObras } from "@/lib/bc";
import { mensajeSeguro } from "@/lib/error-sql";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const sinSesion = await exigirSesion();
  if (sinSesion) return sinSesion;
  try {
    return NextResponse.json({ obras: await bcObras() });
  } catch (e: any) {
    return NextResponse.json({ error: mensajeSeguro(e) }, { status: 500 });
  }
}
