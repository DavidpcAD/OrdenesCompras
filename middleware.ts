import { NextResponse, type NextRequest } from "next/server";
import { SESSION_COOKIE, verifySession, authEnabled } from "@/lib/session";

// Guardia central de acceso. Solo actúa en modo API (producción); en mock local
// deja pasar todo para no estorbar el desarrollo.
//
// Cierra el hueco grande: sin una cookie de sesión VÁLIDA (que solo se obtiene
// logueándose con usuario/contraseña reales) no se puede entrar a las páginas
// de la app ni llamar a las API. Ya no sirve tocar localStorage en la consola.

// API públicas (no requieren sesión).
const PUBLIC_API = ["/api/login", "/api/logout", "/api/health"];

export async function middleware(req: NextRequest) {
  if (!authEnabled()) return NextResponse.next();

  const { pathname } = req.nextUrl;
  const token = req.cookies.get(SESSION_COOKIE)?.value;
  const session = await verifySession(token);

  // ---- API ----
  if (pathname.startsWith("/api/")) {
    if (PUBLIC_API.some((p) => pathname === p || pathname.startsWith(p + "/"))) {
      return NextResponse.next();
    }
    if (!session) {
      return NextResponse.json({ error: "No autenticado." }, { status: 401 });
    }
    return NextResponse.next();
  }

  // ---- Páginas protegidas ----
  if (!session) {
    const url = req.nextUrl.clone();
    url.pathname = "/";
    url.search = "";
    return NextResponse.redirect(url);
  }
  return NextResponse.next();
}

export const config = {
  // Solo corre en las rutas que importan; excluye estáticos y la pantalla de login ("/").
  matcher: ["/proveeduria/:path*", "/facturacion/:path*", "/api/:path*"],
};
