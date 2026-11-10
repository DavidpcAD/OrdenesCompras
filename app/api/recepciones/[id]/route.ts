import { NextResponse } from "next/server";
import { setRecepcionFactura } from "@/lib/repo";
import { actor, exigirSesion } from "@/lib/actor";
import { mensajeSeguro } from "@/lib/error-sql";
import { parcialValido } from "@/lib/guardado-tras-bc";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// MODO 2: registrar la factura de una recepción que estaba EN REVISIÓN.
export async function PATCH(req: Request, { params }: { params: { id: string } }) {
  const sinSesion = await exigirSesion();
  if (sinSesion) return sinSesion;
  try {
    const body = await req.json();
    const a = await actor({ ...body, rol: body.rol ?? "facturacion" });
    // `parcial`: la factura no trae todo lo recibido; lo demás sigue en revisión.
    const fecha = typeof body.fechaFactura === "string" && /^\d{4}-\d{2}-\d{2}$/.test(body.fechaFactura) ? body.fechaFactura : undefined;
    const r = await setRecepcionFactura(Number(params.id), String(body.numeroFactura ?? ""), a.usuario, a.rol, undefined, parcialValido(body.parcial), fecha);
    return NextResponse.json({ ok: true, ...r });
  } catch (e: any) {
    return NextResponse.json({ error: mensajeSeguro(e) }, { status: 500 });
  }
}
