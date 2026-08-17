import { cookies } from "next/headers";
import { SESSION_COOKIE, verifySession, authEnabled } from "./session";
import type { Role } from "./types";

// Quién está haciendo la acción, según la COOKIE FIRMADA — no según el body.
//
// Las rutas de escritura recibían `usuario` y `rol` en el JSON y los guardaban tal
// cual en dbo.Movimiento y en creadoPor/modificadoPor. Eso es falsificable con un
// `curl`: cualquiera con sesión podía dejar una devolución o una recepción firmada
// con el nombre de otra persona. Para todo lo que queda en la bitácora manda la
// sesión; el body solo se usa si no hay sesión (local/mock, donde authEnabled() es
// false y no hay a quién creerle).
export async function actor(body?: { usuario?: unknown; rol?: unknown }): Promise<{ usuario: string; rol: Role }> {
  const delBody = {
    usuario: String(body?.usuario ?? "").trim() || "Sistema",
    rol: (typeof body?.rol === "string" ? body.rol : "proveeduria") as Role,
  };
  if (!authEnabled()) return delBody;
  const s = await verifySession(cookies().get(SESSION_COOKIE)?.value);
  return s ? { usuario: s.n || s.u, rol: s.r } : delBody;
}
