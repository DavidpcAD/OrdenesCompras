import { NextResponse } from "next/server";
import { setRecepcionFactura } from "@/lib/repo";
import { actor } from "@/lib/actor";
import { mensajeSeguro } from "@/lib/error-sql";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// MODO 2: registrar la factura de una recepción que estaba EN REVISIÓN.
export async function PATCH(req: Request, { params }: { params: { id: string } }) {
  try {
    const body = await req.json();
    const a = await actor({ ...body, rol: body.rol ?? "facturacion" });
    await setRecepcionFactura(Number(params.id), String(body.numeroFactura ?? ""), a.usuario, a.rol);
    return NextResponse.json({ ok: true });
  } catch (e: any) {
    return NextResponse.json({ error: mensajeSeguro(e) }, { status: 500 });
  }
}
