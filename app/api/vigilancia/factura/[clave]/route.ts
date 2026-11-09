import { NextRequest, NextResponse } from "next/server";
import { bcFacturaCompraConLineas, bcNotasDeFactura, type BcFacturaCompraDetalle } from "@/lib/bc";
import { facturasYProveedoresDeBc } from "@/lib/bc-facturas-cache";
import { candidatosDeFactura, cotejarRenglones, type Candidato, type CotejoRenglones } from "@/lib/candidatos-bc";
import { leerLineasXml, leerResumenXml, type LineaComprobante, type ResumenComprobante } from "@/lib/cruce-correo-bc";
import {
  facturasAnuladas, numeroDigitadoEs, sinPuntoFinal,
  type DuennoEnlace, type NotaQueAnula, type OtroComprobante,
} from "@/lib/enlace-factura";
import { estadoBuzon, xmlDeComprobante } from "@/lib/graph-buzon";
import { estaRegistrada } from "@/lib/vigilancia-facturas";
import {
  leerFacturaCorreo, tablaCorreoExiste, FALTA_TABLA, bcNumerosEnlazados,
  enlazarFacturaBc, desenlazarFacturaBc, guardarNota, facturaCorreoPorBcNumero,
  marcarFacturaCorreo, moverEnlaceBc, otrosDelEmisor, CERRABLES, type FacturaCorreo, type EstadoFactura,
} from "@/lib/repo-facturas-correo";
import { actor, exigirSesion } from "@/lib/actor";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// GET  /api/vigilancia/factura/<clave>            → los dos lados, más los candidatos
// GET  /api/vigilancia/factura/<clave>?bc=CFR-…   → el lado de BC es ESA factura (mirar antes de enlazar)
// POST /api/vigilancia/factura/<clave>            → { bcNumero } enlazar · { bcNumero: null } soltar
//                                                   { bcNumero, mover: true } quitársela a otro y enlazarla acá
//                                                   { estado, nota } cerrar o reabrir · { nota } comentar
//
// LOS DOS LADOS DE UNA FACTURA, y la salida cuando no calzan solos.
//
// La lista contesta "¿está en BC?" y esto contesta "¿está por lo mismo?". Pero hay un
// tercer caso, que es el que llenaba el Excel de Contabilidad: SÍ está en BC y el
// cotejo no la encuentra porque el digitador tecleó mal el número del proveedor. Para
// esos, la ruta devuelve CANDIDATOS —mismo proveedor, mismo monto, misma fecha— y la
// persona enlaza el que es. Ver lib/candidatos-bc.ts: propone, no enlaza.
//
// Cada lado va por su lado y se traen en paralelo: que Graph esté caído no es razón
// para esconder lo que BC sí contestó.

export type LadoCorreo =
  | { ok: true; archivo: string; lineas: LineaComprobante[]; resumen: ResumenComprobante }
  | { ok: false; error: string };

export type LadoBc =
  | {
      ok: true; factura: BcFacturaCompraDetalle; esPrevia: boolean;
      /** Las notas de crédito que dejan ESTA factura en cero. Vacío = está vigente. */
      anuladaPor: NotaQueAnula[];
    }
  | { ok: false; error: string };

export type RespuestaFactura = {
  factura: FacturaCorreo;
  correo: LadoCorreo;
  bc: LadoBc;
  candidatos: Candidato[];
  candidatosError?: string;
  renglones: CotejoRenglones | null;
  /** Mirando una factura de BC (`?bc=`) que ya tiene OTRO comprobante: cuál es. */
  duenno: DuennoEnlace | null;
  /** En BC se digitó el N.º de ESTE comprobante. */
  numeroEsDeEste: boolean;
  /** Con una factura enlazada: a cuáles del mismo emisor se le podría pasar. */
  otros: OtroComprobante[];
};

// Cuántos días atrás se baja de BC para buscar candidatos. La factura de BC cae casi
// siempre el mismo día del comprobante, pero se pide con aire porque la misma lista
// la reusa la sincronización, que sí mira hacia atrás.
const DIAS_ATRAS = 45;

export async function GET(req: NextRequest, { params }: { params: { clave: string } }) {
  const sinSesion = await exigirSesion();
  if (sinSesion) return sinSesion;
  try {
    const clave = String(params.clave ?? "").trim();
    if (clave.length !== 50) {
      return NextResponse.json({ error: "La clave del comprobante no tiene 50 dígitos." }, { status: 400 });
    }
    if (!(await tablaCorreoExiste())) {
      return NextResponse.json({ error: FALTA_TABLA }, { status: 503 });
    }

    const factura = await leerFacturaCorreo(clave);
    if (!factura) {
      return NextResponse.json({ error: "Ese comprobante no está en la auditoría." }, { status: 404 });
    }

    // Con `?bc=` se mira una factura que TODAVÍA no está enlazada: es el paso previo a
    // decir "sí, es esta". El que se mira manda sobre el que está guardado.
    const previa = (req.nextUrl.searchParams.get("bc") ?? "").trim();
    const numeroBc = previa || factura.bcNumero || "";

    const [correo, bc, candidatos, otra, otros] = await Promise.all([
      ladoCorreo(factura.webLink, clave),
      ladoBc(numeroBc, !!previa),
      // Los candidatos solo hacen falta cuando no hay nada enlazado. Con una factura
      // ya amarrada, ofrecer alternativas es ruido — y si resultó ser la equivocada,
      // primero se suelta y ahí vuelven a salir. Amarrada a un BORRADOR cuenta como
      // nada: al registrarse, BC lo borra y el CFR- que queda es justo el candidato.
      factura.bcNumero && estaRegistrada({ numero: factura.bcNumero })
        ? Promise.resolve({ lista: [] as Candidato[], error: undefined as string | undefined })
        : buscarCandidatos(factura),
      // Lo que hay que saber ANTES de tocar "Sí, es esta": si esa factura de BC ya
      // respalda otro comprobante. Antes se enteraba uno después, en un aviso rojo.
      previa ? quienLaTiene(previa, clave) : Promise.resolve(null),
      // Y del otro lado: si la que se quedó ESTE comprobante es de otro, a cuál.
      factura.bcNumero && !previa
        ? otrosDelEmisor(factura, factura.bcTotal ?? factura.total).catch(() => [] as FacturaCorreo[])
        : Promise.resolve([] as FacturaCorreo[]),
    ]);
    const numeroProveedor = bc.ok ? bc.factura.numeroProveedor : "";

    return NextResponse.json({
      factura, correo, bc,
      candidatos: candidatos.lista,
      candidatosError: candidatos.error,
      renglones: correo.ok && bc.ok
        ? cotejarRenglones(
            correo.lineas.map((l) => ({ total: l.total, cantidad: l.cantidad, precioUnitario: l.precioUnitario })),
            bc.factura.lineas.map((l) => ({ total: l.total, cantidad: l.cantidad, precioUnitario: l.precioUnitario })),
          )
        : null,
      duenno: otra ? {
        clave: otra.clave, consecutivo: otra.consecutivo, nombreEmisor: otra.nombreEmisor,
        fechaEmision: otra.fechaEmision, total: otra.total, moneda: otra.moneda,
        bcCalzePor: otra.bcCalzePor, revisadoPor: otra.revisadoPor,
        numeroEsDeEl: numeroDigitadoEs(otra.consecutivo, numeroProveedor),
      } : null,
      numeroEsDeEste: numeroDigitadoEs(factura.consecutivo, numeroProveedor),
      otros: otros.map((o) => ({
        clave: o.clave, consecutivo: o.consecutivo, tipoDoc: o.tipoDoc, fechaEmision: o.fechaEmision,
        total: o.total, moneda: o.moneda, nota: o.nota,
        numeroEsDeEl: numeroDigitadoEs(o.consecutivo, numeroProveedor),
      })),
    } satisfies RespuestaFactura);
  } catch (e: any) {
    console.error("vigilancia/factura GET:", e?.message ?? e);
    return NextResponse.json({ error: e?.message ?? "No se pudo abrir la factura." }, { status: 500 });
  }
}

export async function POST(req: NextRequest, { params }: { params: { clave: string } }) {
  const sinSesion = await exigirSesion();
  if (sinSesion) return sinSesion;
  try {
    const clave = String(params.clave ?? "").trim();
    if (clave.length !== 50) {
      return NextResponse.json({ error: "La clave del comprobante no tiene 50 dígitos." }, { status: 400 });
    }
    const body = await req.json().catch(() => ({} as any));
    const a = await actor(body).catch(() => ({ usuario: "sistema" } as any));
    const usuario = a?.usuario ?? "sistema";

    const factura = await leerFacturaCorreo(clave);
    if (!factura) {
      return NextResponse.json({ error: "Ese comprobante no está en la auditoría." }, { status: 404 });
    }

    // --- soltar el enlace -----------------------------------------------------
    if ("bcNumero" in body && !body.bcNumero) {
      // Un calce automático se suelta solo si la factura de BC está ANULADA: ahí el
      // cotejo ya no la vuelve a tomar. Si está vigente, soltarlo no serviría de nada
      // —el N.º digitado en BC la volvería a amarrar en tres minutos— y lo que corresponde
      // es pasársela al comprobante que sí es.
      if (factura.bcCalzePor !== "manual") {
        const anulada = factura.bcNumero ? await facturaAnuladaEnBc(factura.bcNumero) : false;
        if (!anulada) {
          return NextResponse.json(
            { error: "Este calce lo hizo el cotejo automático por el N.º digitado en BC. Si la factura es de otro comprobante, pasásela desde \"¿Es de otro comprobante?\"." },
            { status: 409 },
          );
        }
      }
      await desenlazarFacturaBc(clave, usuario, { tambienAutomatico: factura.bcCalzePor !== "manual" });
      return NextResponse.json({ ok: true, factura: await leerFacturaCorreo(clave) });
    }

    // --- enlazar --------------------------------------------------------------
    if (body.bcNumero) {
      const numero = String(body.bcNumero).trim();
      // Se lee de BC ANTES de guardar: enlazar contra un número que allá no existe
      // dejaría la fila diciendo "registrada" con un enlace que abre una lista vacía.
      const enBc = await bcFacturaCompraConLineas(numero).catch(() => null);
      if (!enBc) {
        return NextResponse.json(
          { error: `Business Central no tiene ninguna factura de compra ${numero}. Revisá el número.` },
          { status: 404 },
        );
      }
      // Un borrador todavía no está en los libros, y al registrarlo BC lo borra y le da
      // otro número (CFR-…): el enlace quedaría apuntando a la nada con la fila diciendo
      // "registrada". Pasó con el cotejo automático en nov 2026; a mano tampoco.
      if (!estaRegistrada(enBc)) {
        return NextResponse.json(
          { error: `${enBc.numero} todavía es un borrador en Business Central: no está registrada. Cuando la registren allá, el cotejo la encuentra sola; si no, enlazá el CFR- que le quede.` },
          { status: 409 },
        );
      }
      const cuadra = enBc.moneda === factura.moneda && Math.abs(enBc.total - factura.total) <= 0.5;
      const datos = { numero: enBc.numero, proveedor: enBc.proveedorCodigo, total: enBc.total, cuadra };
      const nota = typeof body.nota === "string" ? body.nota : undefined;

      const duenno = await quienLaTiene(numero, clave);
      if (duenno) {
        // Pasarla de un comprobante al otro tiene que ser una decisión explícita: el
        // diálogo enseña antes a quién se la quita y por qué la tenía (`duenno`), y
        // manda `mover: true` solo desde el botón que lo dice.
        if (body.mover !== true) {
          return NextResponse.json(
            { error: `${numero} ya está enlazada al comprobante ${duenno.consecutivo} de ${sinPuntoFinal(duenno.nombreEmisor)}. Si es de este, usá "Pasarla a este comprobante".` },
            { status: 409 },
          );
        }
        const hoyCr = new Date().toLocaleDateString("es-CR", { timeZone: "America/Costa_Rica" });
        const movida = await moverEnlaceBc(duenno.clave, clave, datos, usuario, {
          destino: nota,
          origen: `${numero} se pasó al comprobante ${factura.consecutivo} (${usuario}, ${hoyCr}).`,
        });
        if (!movida) {
          return NextResponse.json(
            { error: `${numero} cambió de comprobante mientras tanto. Cerrá y volvé a abrir esta factura para ver cómo quedó.` },
            { status: 409 },
          );
        }
        return NextResponse.json({ ok: true, factura: await leerFacturaCorreo(clave) });
      }

      await enlazarFacturaBc(clave, datos, usuario, nota);
      return NextResponse.json({ ok: true, factura: await leerFacturaCorreo(clave) });
    }

    // --- cerrar el caso, o reabrirlo ------------------------------------------
    // La salida para lo que NUNCA va a estar en BC: una compra personal, algo de otra
    // empresa del grupo, un comprobante que llegó dos veces. No es un error del
    // digitador ni una factura perdida, así que dejarla "sin registrar" para siempre
    // ensucia la lista y baja el porcentaje acusando un atraso que no existe.
    if (typeof body.estado === "string") {
      const estado = body.estado as EstadoFactura;
      if (!CERRABLES.includes(estado)) {
        return NextResponse.json(
          { error: `No se puede marcar como "${estado}" a mano. Solo: ${CERRABLES.join(", ")}.` },
          { status: 400 },
        );
      }
      // Cerrar SIN decir por qué no sirve de nada: dentro de un mes nadie se acuerda,
      // y el que revise después no puede distinguir un caso resuelto de uno que
      // alguien quiso sacar de la lista.
      const motivo = String(body.nota ?? "").trim();
      if (estado !== "pendiente" && !motivo) {
        return NextResponse.json({ error: "Escribí por qué esta factura no tiene que estar en Business Central." }, { status: 400 });
      }
      // Una factura amarrada a una de BC no se puede cerrar como "no aplica": son
      // afirmaciones que se contradicen. Primero se suelta el enlace.
      if (estado !== "pendiente" && factura.bcNumero) {
        return NextResponse.json(
          { error: `Esta factura está enlazada a ${factura.bcNumero} en Business Central. Soltá el enlace antes de cerrarla como que no aplica.` },
          { status: 409 },
        );
      }
      await marcarFacturaCorreo(clave, estado, usuario, motivo);
      return NextResponse.json({ ok: true, factura: await leerFacturaCorreo(clave) });
    }

    // --- solo el comentario ---------------------------------------------------
    if (typeof body.nota === "string") {
      await guardarNota(clave, body.nota, usuario);
      return NextResponse.json({ ok: true, factura: await leerFacturaCorreo(clave) });
    }

    return NextResponse.json({ error: "No se dijo qué hacer: falta bcNumero, estado o nota." }, { status: 400 });
  } catch (e: any) {
    console.error("vigilancia/factura POST:", e?.message ?? e);
    return NextResponse.json({ error: e?.message ?? "No se pudo guardar." }, { status: 500 });
  }
}

// ---------------------------------------------------------------------------

async function ladoCorreo(webLink: string | null, clave: string): Promise<LadoCorreo> {
  const buzon = estadoBuzon();
  if (!buzon.listo) return { ok: false, error: buzon.falta };
  if (!webLink) {
    return { ok: false, error: "De este comprobante no se guardó el correo de origen, así que no hay XML que abrir." };
  }
  try {
    const adj = await xmlDeComprobante(webLink, clave);
    if (!adj) {
      return {
        ok: false,
        error: "El XML ya no está en ese correo. Puede que lo movieran de carpeta o lo borraran; el enlace de arriba abre el correo en Outlook.",
      };
    }
    return { ok: true, archivo: adj.archivo, lineas: leerLineasXml(adj.xml), resumen: leerResumenXml(adj.xml) };
  } catch (e: any) {
    return { ok: false, error: e?.message ?? "No se pudo leer el XML del correo." };
  }
}

async function ladoBc(bcNumero: string, esPrevia: boolean): Promise<LadoBc> {
  if (!bcNumero) return { ok: false, error: "Todavía no se ha encontrado esta factura en Business Central." };
  try {
    const [factura, notas] = await Promise.all([
      bcFacturaCompraConLineas(bcNumero),
      // Que falle esta lectura no es razón para no mostrar la factura.
      bcNotasDeFactura(bcNumero).catch(() => []),
    ]);
    if (!factura) return { ok: false, error: `Business Central ya no tiene la factura ${bcNumero}.` };
    const anuladaPor = facturasAnuladas([factura], notas).get(factura.numero) ?? [];
    return { ok: true, factura, esPrevia, anuladaPor };
  } catch (e: any) {
    return { ok: false, error: e?.message ?? "No se pudo leer la factura en Business Central." };
  }
}

async function buscarCandidatos(f: FacturaCorreo): Promise<{ lista: Candidato[]; error: string | undefined }> {
  try {
    const desde = corre(f.fechaEmision || hoy(), -DIAS_ATRAS);
    const [{ facturas, proveedores }, enlazadas] = await Promise.all([
      facturasYProveedoresDeBc(desde),
      bcNumerosEnlazados(),
    ]);
    return {
      lista: candidatosDeFactura(
        {
          consecutivo: f.consecutivo, tipoDoc: f.tipoDoc,
          cedulaEmisor: f.cedulaEmisor, nombreEmisor: f.nombreEmisor,
          fecha: f.fechaEmision, total: f.total, moneda: f.moneda,
        },
        facturas, proveedores, { yaEnlazadas: enlazadas },
      ),
      error: undefined,
    };
  } catch (e: any) {
    // Sin candidatos la pantalla sigue sirviendo: se ve el lado del correo y se puede
    // escribir el N.º de BC a mano.
    return { lista: [], error: e?.message ?? "No se pudieron buscar candidatos en Business Central." };
  }
}

/** ¿Las notas de crédito registradas dejan esa factura de BC en cero? */
async function facturaAnuladaEnBc(numero: string): Promise<boolean> {
  const [f, notas] = await Promise.all([
    bcFacturaCompraConLineas(numero).catch(() => null),
    bcNotasDeFactura(numero).catch(() => []),
  ]);
  return !!f && facturasAnuladas([f], notas).has(f.numero);
}

/** Si ese N.º de BC ya está amarrado a OTRO comprobante, cuál es. */
async function quienLaTiene(numero: string, exceptoClave: string): Promise<FacturaCorreo | null> {
  const otra = await facturaCorreoPorBcNumero(numero);
  return otra && otra.clave !== exceptoClave ? otra : null;
}

const hoy = () => new Date().toISOString().slice(0, 10);

function corre(iso: string, dias: number): string {
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return iso;
  return new Date(t + dias * 86_400_000).toISOString().slice(0, 10);
}
