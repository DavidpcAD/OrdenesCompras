import { NextRequest, NextResponse } from "next/server";
import { timingSafeEqual } from "node:crypto";
import { listOrdenes } from "@/lib/repo";
import { chequearOrdenAFondo } from "@/lib/chequeo-orden";
import type { Orden } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// LA BARRIDA QUE CORRE SOLA.
//
// El detector (`/api/reportes/conciliacion-bc`) existe desde el 2/9/2026 y encuentra
// lo que hay que encontrar, pero solo mira cuando alguien abre la pantalla y aprieta
// "Revisar". Nadie lo hace. Por eso CP-005289 estuvo dos días desalineada, se registró
// la factura a nombre de otro proveedor y nos enteramos seis días después.
//
// Esta ruta es la misma revisión, disparada por un reloj en vez de por una persona.
// La llama un temporizador externo (GitHub Actions, ver .github/workflows/
// conciliacion-bc.yml) con un secreto en la cabecera.
//
// Tres decisiones que la hacen sostenible:
//
//   · POR TANDAS Y POR ANTIGÜEDAD. Cada orden son una o dos llamadas a BC. Se revisan
//     primero las que nunca se revisaron y las que hace más tiempo que no se miran,
//     así en pocas corridas quedan todas al día y ninguna se queda sin revisar nunca.
//   · PRIORIDAD A LO QUE TODAVÍA SE PUEDE SALVAR. Una orden lanzada y sin recibir se
//     corrige gratis; una completada ya solo se arregla con nota de crédito. Las
//     primeras van antes.
//   · AVISA. Un hallazgo que solo queda escrito en la base no sirve de nada — es
//     exactamente el error que se está tratando de no repetir. Si hay `TAREA_WEBHOOK`
//     se manda el resumen; si no, al menos sale en la respuesta y en el log.
//
// Sin `TAREA_SECRET` configurada la ruta no existe (404): no se deja abierta por
// olvido de configuración.

const POR_CORRIDA = 25;   // ~25 órdenes por corrida: entra cómodo en el timeout.
const EN_PARALELO = 4;    // BC aguanta bien esto; más arriba empieza a tirar 429.

// Comparación en tiempo constante. `timingSafeEqual` exige el mismo largo, así que un
// secreto de otro largo se rechaza antes (no filtra nada: el largo no es el secreto).
function secretoOk(recibido: string, esperado: string): boolean {
  const a = Buffer.from(recibido);
  const b = Buffer.from(esperado);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

// Lo que todavía se puede corregir sin nota de crédito va primero; dentro de cada
// grupo, lo que hace más tiempo que no se mira.
function prioridad(o: Orden): number {
  if (o.estado === "lanzado" || o.estado === "pendiente_aprobacion") return 0;
  if (o.estado === "abierto" || o.estado === "rechazado") return 1;
  return 2;   // completado / cerrado: ya solo queda documentar el daño
}

function masVieja(a: Orden, b: Orden): number {
  const pa = prioridad(a) - prioridad(b);
  if (pa !== 0) return pa;
  // Sin fecha de chequeo = nunca revisada = lo más urgente.
  const fa = a.bcCheck?.fecha ?? "";
  const fb = b.bcCheck?.fecha ?? "";
  if (fa === fb) return 0;
  if (!fa) return -1;
  if (!fb) return 1;
  return fa < fb ? -1 : 1;
}

type Hallazgo = {
  numero: string; bcNumber?: string; proveedor: string; estadoOrden: string;
  estado: string; contra: string; mensaje: string; importeEnJuego: number;
};

// El aviso. Se manda solo si hay algo que decir: una barrida que avisa "todo bien"
// cada hora se convierte en ruido y a la semana nadie la lee.
async function avisar(hallazgos: Hallazgo[]): Promise<string | undefined> {
  const url = (process.env.TAREA_WEBHOOK ?? "").trim();
  if (!url || !hallazgos.length) return undefined;
  const lineas = hallazgos.map((h) =>
    `• ${h.numero}${h.bcNumber ? ` (${h.bcNumber})` : ""} · ${h.proveedor} · ${h.mensaje}`);
  const texto = `Órdenes que NO coinciden con Business Central (${hallazgos.length}):\n${lineas.join("\n")}`;
  try {
    const res = await fetch(url, {
      method: "POST", cache: "no-store",
      headers: { "Content-Type": "application/json" },
      // `text` es lo que entienden los webhooks de Teams/Slack; `hallazgos` va para
      // cualquier otra cosa que quiera leer el detalle.
      body: JSON.stringify({ text: texto, hallazgos }),
    });
    return res.ok ? undefined : `el webhook contestó ${res.status}`;
  } catch (e: any) {
    return String(e?.message ?? e);
  }
}

export async function POST(req: NextRequest) {
  const esperado = (process.env.TAREA_SECRET ?? "").trim();
  // Sin secreto configurado la tarea está apagada, y se comporta como si la ruta no
  // existiera: nada que adivinar, nada que sondear.
  if (!esperado) return NextResponse.json({ error: "No encontrado." }, { status: 404 });
  const recibido = (req.headers.get("x-tarea-secret") ?? "").trim();
  if (!recibido || !secretoOk(recibido, esperado)) {
    return NextResponse.json({ error: "No autorizado." }, { status: 401 });
  }

  try {
    const cuantas = Math.min(Math.max(Number(req.nextUrl.searchParams.get("limite") ?? POR_CORRIDA) || POR_CORRIDA, 1), 60);
    const todas = (await listOrdenes()).filter((o) => !!o.bcNumber);
    const tanda = [...todas].sort(masVieja).slice(0, cuantas);

    const filas: Hallazgo[] = [];
    for (let i = 0; i < tanda.length; i += EN_PARALELO) {
      const grupo = tanda.slice(i, i + EN_PARALELO);
      const res = await Promise.all(grupo.map(async (o): Promise<Hallazgo> => {
        const comun = {
          numero: o.numero, bcNumber: o.bcNumber,
          proveedor: o.proveedorNombre ?? o.proveedorNo ?? o.proveedorId ?? "—",
          estadoOrden: o.estado,
        };
        try {
          const r = await chequearOrdenAFondo(o, { persistir: true, usuario: "tarea", rol: "proveeduria" });
          return { ...comun, estado: r.estado, contra: r.contra, mensaje: r.mensaje, importeEnJuego: r.importeEnJuego };
        } catch (e: any) {
          // Una orden que revienta no puede matar la corrida entera: se reporta como
          // "no se pudo" y se sigue. Callarla sería peor que no revisarla.
          return { ...comun, estado: "sin-lectura", contra: "nada", mensaje: String(e?.message ?? e), importeEnJuego: 0 };
        }
      }));
      filas.push(...res);
    }

    // "sin-lectura" NO es un hallazgo: es que BC no contestó. Avisarlo sería llenar de
    // falsas alarmas el canal justo cuando BC anda lento, y entonces el aviso de
    // verdad se pierde entre el ruido — que es como empezó todo esto.
    // Lo que cuesta una nota de crédito va PRIMERO. Un aviso donde el problema de
    // proveedor aparece en la línea 14, debajo de trece órdenes que solo hay que
    // cerrar, es un aviso que nadie termina de leer.
    const hallazgos = filas
      .filter((f) => f.estado === "desalineado" || f.estado === "sin-pedido")
      .sort((a, b) => Number(/PROVEEDOR/i.test(b.mensaje)) - Number(/PROVEEDOR/i.test(a.mensaje)));
    const avisoError = await avisar(hallazgos);
    if (hallazgos.length) {
      console.warn(`[conciliacion-bc] ${hallazgos.length} orden(es) no coinciden con BC:`,
        hallazgos.map((h) => `${h.numero}/${h.bcNumber}`).join(", "));
    }

    return NextResponse.json({
      ok: true,
      revisadas: filas.length,
      conBcTotal: todas.length,
      resumen: {
        ok: filas.filter((f) => f.estado === "ok").length,
        desalineadas: filas.filter((f) => f.estado === "desalineado").length,
        sinPedido: filas.filter((f) => f.estado === "sin-pedido").length,
        sinLectura: filas.filter((f) => f.estado === "sin-lectura").length,
      },
      hallazgos,
      avisoError,
    });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: String(e?.message ?? e) }, { status: 500 });
  }
}
