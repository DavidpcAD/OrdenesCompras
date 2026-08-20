import { NextResponse } from "next/server";
import { createHash } from "node:crypto";
import { listNotasCredito, listOrdenes, listPedidos, listRecepciones } from "@/lib/repo";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Carga inicial de la data para el front-end (modo API).
// NO incluye el historial de movimientos: la tabla dbo.Movimiento completa viajaba
// en cada carga Y en cada auto-refresh (45s) solo para pintar el Timeline de dos
// pantallas de detalle. Ahora el Timeline lo pide por entidad a /api/movimientos.
export async function GET(req: Request) {
  try {
    const [pedidos, ordenes, recepciones, notas] = await Promise.all([
      listPedidos(), listOrdenes(), listRecepciones(),
      // Las notas de crédito viajan ACÁ (antes eran un segundo request cada 45 s).
      // Si la tabla no existe todavía, se devuelven vacías sin tumbar la carga.
      listNotasCredito().catch(() => []),
    ]);

    // ETag = huella de EXACTAMENTE lo que se iba a enviar. Con la app abierta todo
    // el día el refresco corre cada 45 s y casi siempre trae lo mismo: sin esto,
    // cada vuelta bajaba todas las órdenes con sus líneas por datos móviles y el
    // celular las volvía a parsear. Con el 304 el cuerpo no viaja.
    //
    // Se calcula sobre el payload real (no sobre conteos ni fechas de la base) a
    // propósito: cualquier atajo se arriesga a NO detectar un cambio y dejar la
    // pantalla vieja creyendo que está al día, que es justo lo que hay que evitar.
    const body = JSON.stringify({ pedidos, ordenes, recepciones, notas });
    const etag = `W/"${createHash("sha1").update(body).digest("base64url")}"`;

    if (req.headers.get("if-none-match") === etag) {
      return new NextResponse(null, { status: 304, headers: { ETag: etag } });
    }
    return new NextResponse(body, {
      status: 200,
      headers: { "Content-Type": "application/json; charset=utf-8", ETag: etag },
    });
  } catch (e: any) {
    // El detalle va al log del server (Azure), NO a la pantalla: el mensaje crudo
    // de mssql dice motor, host y puerto ("Failed to connect to …:1433"), o sea le
    // cuenta la infraestructura a cualquiera que abra la app. Igual que en el login.
    console.error("bootstrap", e);
    return NextResponse.json(
      { error: "No se pudo consultar la base de datos ahora mismo. Reintentá; si sigue, avisale a TI." },
      { status: 500 }
    );
  }
}
