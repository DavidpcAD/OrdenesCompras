import { NextResponse } from "next/server";
import { listVistas, saveVista } from "@/lib/repo";
import { mensajeParaPantalla } from "@/lib/error-sql";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Vistas de tabla guardadas por usuario. GET ?usuario=&tabla=
export async function GET(req: Request) {
  try {
    const u = new URL(req.url);
    const usuario = u.searchParams.get("usuario") ?? "";
    const tabla = u.searchParams.get("tabla") ?? "";
    if (!usuario || !tabla) return NextResponse.json({ vistas: [] });
    return NextResponse.json({ vistas: await listVistas(usuario, tabla) });
  } catch (e: any) {
    // El detalle va al log del server, NO a la pantalla: el mensaje crudo de mssql
    // dice motor, host y puerto. Mismo criterio que /api/bootstrap.
    console.error("vistas GET", e);
    return NextResponse.json({ error: mensajeParaPantalla(e, "No se pudieron traer las vistas guardadas") }, { status: 500 });
  }
}

export async function POST(req: Request) {
  try {
    const b = await req.json();
    if (!b?.usuario || !b?.tabla || !b?.nombre) return NextResponse.json({ error: "Faltan usuario, tabla o nombre" }, { status: 400 });
    const id = await saveVista({ usuario: String(b.usuario), tablaKey: String(b.tabla), nombre: String(b.nombre), config: b.config ?? {}, esPredeterminada: !!b.esPredeterminada });
    return NextResponse.json({ id }, { status: 201 });
  } catch (e: any) {
    console.error("vistas POST", e);
    return NextResponse.json({ error: mensajeParaPantalla(e, "No se pudo guardar la vista") }, { status: 500 });
  }
}
