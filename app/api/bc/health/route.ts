import { NextResponse } from "next/server";
import { exigirSesion } from "@/lib/actor";
import { bcHealth } from "@/lib/bc";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const fetchCache = "force-no-store";
export const revalidate = 0;

export async function GET() {
  const sinSesion = await exigirSesion();
  if (sinSesion) return sinSesion;
  try {
    return NextResponse.json(await bcHealth());
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: String(e?.message ?? e) }, { status: 500 });
  }
}
