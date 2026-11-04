import { NextResponse } from "next/server";
import { autenticar } from "@/lib/auth";
import { SESSION_COOKIE, signSession, authEnabled, sessionCookieOptions } from "@/lib/session";
import { demoraPorFallos, esperar, esperaAntesDeIntentar, ipCliente, registrarExito, registrarFallo, textoEspera, FALLOS_SOSPECHOSOS } from "@/lib/login-throttle";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  try {
    const body = await req.json().catch(() => ({}));
    const usuarioIntento = String(body?.username ?? "");
    // Todo intento queda en el log de Azure con la marca "[seguridad]", para poder
    // buscar quién entró desde dónde y si alguien está probando claves. El usuario
    // se recorta: a veces la gente escribe la contraseña en el campo equivocado.
    const ip = ipCliente(req.headers.get("x-forwarded-for"));
    const quien = usuarioIntento.trim().slice(0, 40);

    // Pausa dura (lib/login-throttle.ts): con demasiados fallos seguidos, ni se mira la
    // contraseña hasta que pase la pausa. Se contesta con el tiempo concreto.
    const pausa = esperaAntesDeIntentar(usuarioIntento, ip);
    if (pausa) {
      console.warn(`[seguridad] login frenado por intentos fallidos · por=${pausa.por} · usuario=${quien} · ip=${ip} · faltan=${Math.ceil(pausa.ms / 1000)}s`);
      const cuanto = textoEspera(pausa.ms);
      const error = pausa.por === "usuario"
        ? `Demasiados intentos fallidos con este usuario. Esperá ${cuanto} y volvé a probar. Si no recordás la contraseña, escribile a TI (davidpc@adelante.cr).`
        : `Demasiados intentos fallidos desde esta conexión. Esperá ${cuanto} y volvé a probar.`;
      return NextResponse.json({ error }, { status: 429, headers: { "Retry-After": String(Math.ceil(pausa.ms / 1000)) } });
    }

    // Freno suave: los fallos del mismo usuario se van demorando. La demora se aplica
    // ANTES de contestar el 401.
    const demora = demoraPorFallos(usuarioIntento);
    const res = await autenticar(usuarioIntento, String(body?.password ?? ""));
    if (!res.ok) {
      const fallos = registrarFallo(usuarioIntento, ip);
      const marca = fallos >= FALLOS_SOSPECHOSOS ? " · POSIBLE FUERZA BRUTA" : "";
      console.warn(`[seguridad] login fallido · usuario=${quien} · ip=${ip} · fallos15min=${fallos}${marca}`);
      await esperar(demora);
      return NextResponse.json({ error: res.error }, { status: 401 });
    }
    registrarExito(usuarioIntento);
    console.info(`[seguridad] login ok · usuario=${quien} · rol=${res.user.role} · ip=${ip}`);
    const { role, nombre, username, rolNombre, huella } = res.user;

    const out = NextResponse.json({ role, nombre, username, rolNombre });
    // Solo en modo API (producción): emitimos la cookie de sesión FIRMADA. Si
    // falta SESSION_SECRET, signSession lanza y respondemos 500 con mensaje claro.
    if (authEnabled()) {
      // La huella de la clave va DENTRO de la cookie firmada (nunca en el JSON): es
      // lo que permite cerrar esta sesión cambiando la contraseña (lib/sesion-vigente.ts).
      const token = await signSession(username, role, nombre, huella);
      // Mismas opciones que usa el middleware al renovarla (un solo lugar).
      out.cookies.set(SESSION_COOKIE, token, sessionCookieOptions());
    }
    return out;
  } catch (e: any) {
    // El detalle va al log del server (Azure), NO a la pantalla de login: antes se
    // devolvía tal cual y la página mostraba "Failed to connect to :1433 …", o sea
    // le contaba a cualquiera qué motor y qué puerto hay detrás.
    console.error("login", e);
    return NextResponse.json(
      { error: "No se pudo validar el usuario ahora mismo. Intentá de nuevo; si sigue, avisale a TI." },
      { status: 500 }
    );
  }
}
