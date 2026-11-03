import { NextRequest, NextResponse } from "next/server";
import { exigirSesion } from "@/lib/actor";
import { bcJobTasks } from "@/lib/bc";
import { mensajeSeguro } from "@/lib/error-sql";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// GET /api/bc/jobtasks?jobNo=OR-4321  (jobNo opcional; sin él devuelve todas).
// Catálogo de tareas de obra desde BC (jobTasks, page 50154).
export async function GET(req: NextRequest) {
  const sinSesion = await exigirSesion();
  if (sinSesion) return sinSesion;
  const { searchParams } = new URL(req.url);
  const jobNo = searchParams.get("jobNo") ?? undefined;
  try {
    return NextResponse.json({ jobTasks: await bcJobTasks(jobNo) });
  } catch (e: any) {
    return NextResponse.json({ error: mensajeSeguro(e) }, { status: 500 });
  }
}
