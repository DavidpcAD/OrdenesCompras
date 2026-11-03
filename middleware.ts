import { NextResponse, type NextRequest } from "next/server";
import { SESSION_COOKIE, verifySession, authEnabled, debeRenovar, signSession, sessionCookieOptions, type SessionPayload } from "@/lib/session";
import { autorizacionActiva, mensajeNoAutorizado, rolPuede } from "@/lib/autorizacion";
import { frenoOrigenActivo, origenAjeno } from "@/lib/origen";

// Guardia central de acceso. Solo actúa en modo API (producción); en mock local
// deja pasar todo para no estorbar el desarrollo.
//
// Cierra el hueco grande: sin una cookie de sesión VÁLIDA (que solo se obtiene
// logueándose con usuario/contraseña reales) no se puede entrar a las páginas
// de la app ni llamar a las API. Ya no sirve tocar localStorage en la consola.

// API públicas (no requieren sesión).
const PUBLIC_API = ["/api/login", "/api/logout", "/api/health"];

// Renovación deslizante: si a la sesión le queda poco, se vuelve a firmar y se
// devuelve la cookie nueva en ESTA respuesta. Así quien está trabajando nunca ve
// un 401 en medio de la jornada (era la causa del aviso "No autenticado" con la
// pantalla ya abierta); la sesión solo caduca tras 12 h SIN usar la app.
async function conSesionRenovada(res: NextResponse, session: SessionPayload): Promise<NextResponse> {
  if (!debeRenovar(session)) return res;
  try {
    const token = await signSession(session.u, session.r, session.n);
    res.cookies.set(SESSION_COOKIE, token, sessionCookieOptions());
  } catch {
    // Si firmar falla, seguimos con la cookie vieja: pierde la renovación, pero
    // NO tumbamos el request (mejor sesión corta que pantalla caída).
  }
  return res;
}

const ipDe = (req: NextRequest) => (req.headers.get("x-forwarded-for") ?? "").split(",")[0].trim() || req.ip || "?";

export async function middleware(req: NextRequest) {
  if (!authEnabled()) return NextResponse.next();

  const { pathname } = req.nextUrl;
  const token = req.cookies.get(SESSION_COOKIE)?.value;
  const session = await verifySession(token);

  // ---- API ----
  if (pathname.startsWith("/api/")) {
    // CSRF: antes que nada, también para el login (ver lib/origen.ts).
    const ajeno = frenoOrigenActivo()
      ? origenAjeno(req.method, req.headers.get("origin"),
          [req.headers.get("x-forwarded-host"), req.headers.get("host"), req.nextUrl.host].filter(Boolean).join(","))
      : null;
    if (ajeno) {
      console.warn(`[seguridad] escritura desde otro sitio rechazada · ${req.method} ${pathname} · origin=${ajeno} · usuario=${session?.u ?? "-"} · ip=${ipDe(req)}`);
      return NextResponse.json(
        { error: "Esta acción tiene que hacerse desde la app de Compras. Si la abriste desde otro sitio o enlace, entrá directo y volvé a intentarlo." },
        { status: 403 }
      );
    }
    if (PUBLIC_API.some((p) => pathname === p || pathname.startsWith(p + "/"))) {
      return NextResponse.next();
    }
    if (!session) {
      return NextResponse.json({ error: "No autenticado." }, { status: 401 });
    }
    // Autenticado ≠ autorizado: además del login, el ROL tiene que corresponder a
    // la acción. Solo aplica a escrituras y a las rutas listadas en
    // lib/autorizacion.ts; se apaga con AUTORIZACION_ROLES=0 (sin redeploy).
    if (autorizacionActiva() && !rolPuede(pathname, req.method, session.r)) {
      // Con la UI respetando el rol, esto no pasa por accidente: alguien llamó la
      // API a mano. Queda en el log de Azure para poder buscarlo ("[seguridad]").
      console.warn(`[seguridad] rol sin permiso · ${req.method} ${pathname} · usuario=${session.u} rol=${session.r} · ip=${ipDe(req)}`);
      return NextResponse.json({ error: mensajeNoAutorizado(pathname, req.method) }, { status: 403 });
    }
    return conSesionRenovada(NextResponse.next(), session);
  }

  // ---- Páginas protegidas ----
  if (!session) {
    const url = req.nextUrl.clone();
    url.pathname = "/";
    // Se le dice al login POR QUÉ está ahí y A DÓNDE volver: sin esto, quien
    // llevaba media orden escrita aterrizaba en el login sin explicación y
    // después tenía que buscar de nuevo la pantalla donde estaba.
    url.search = `?motivo=sesion&next=${encodeURIComponent(pathname + (req.nextUrl.search || ""))}`;
    return NextResponse.redirect(url);
  }
  return conSesionRenovada(NextResponse.next(), session);
}

export const config = {
  // Solo corre en las rutas que importan; excluye estáticos y la pantalla de login ("/").
  matcher: ["/proveeduria/:path*", "/facturacion/:path*", "/api/:path*"],
};
