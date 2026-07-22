import crypto from "crypto";
import { getPool, sql } from "./db";
import type { Role } from "./types";

// idRol (dbo.Rol) -> módulo de la app. Los roles no listados NO tienen acceso.
//   1 Administrador      -> aprobación (aprobador, ej. Luis Roberto)
//   3 Ingeniero Residente-> ingeniería (ej. Laura)
//   5 Proveeduría        -> proveeduría (ej. Angie)
//   6 Facturador Bodega  -> bodega (recibe, ej. Pedro)
const ROL_A_MODULO: Record<number, Role> = {
  1: "aprobacion",
  3: "ingenieria",
  5: "proveeduria",
  6: "facturacion",
};

// Resuelve el módulo por NOMBRE del rol (robusto para separar Bodega vs Contabilidad
// sin depender del idRol exacto). El nombre manda para "contabilidad"; el resto cae
// al mapa por idRol y, si no, a palabras clave del nombre.
//   Bodega (recibe)     -> rol con "bodega" / "facturador" / "recib"  -> facturacion
//   Contabilidad (NC)   -> rol con "contab"                           -> contabilidad
function moduloDeRol(idRol: number, nombre: string): Role | undefined {
  const n = (nombre || "").toLowerCase();
  if (n.includes("contab")) return "contabilidad";
  if (ROL_A_MODULO[idRol]) return ROL_A_MODULO[idRol];
  if (n.includes("bodeg") || n.includes("factur") || n.includes("recib")) return "facturacion";
  if (n.includes("ingenier") || n.includes("resident")) return "ingenieria";
  if (n.includes("proveed") || n.includes("compra")) return "proveeduria";
  if (n.includes("aprob") || n.includes("admin")) return "aprobacion";
  return undefined;
}

// Comparación flexible: soporta texto plano y SHA-256 (hex o base64), sin
// dependencias extra. Si las claves fueran bcrypt habría que agregar bcryptjs.
function passwordOk(input: string, stored: string): boolean {
  if (!stored) return false;
  if (input === stored) return true;
  const hex = crypto.createHash("sha256").update(input).digest("hex");
  if (hex.toLowerCase() === stored.toLowerCase()) return true;
  const b64 = crypto.createHash("sha256").update(input).digest("base64");
  if (b64 === stored) return true;
  return false;
}

export type AuthUser = { username: string; nombre: string; role: Role; idRol: number; rolNombre: string };

export async function autenticar(
  username: string,
  password: string
): Promise<{ ok: true; user: AuthUser } | { ok: false; error: string }> {
  const u = (username ?? "").trim();
  if (!u || !password) return { ok: false, error: "Ingresá usuario y contraseña." };

  const pool = await getPool();
  const r = await pool.request().input("u", sql.NVarChar(100), u).query(
    "SELECT TOP 1 idUsuario, username, passwordHash FROM dbo.Usuario WHERE username = @u"
  );
  const row = r.recordset[0];
  if (!row || !passwordOk(password, row.passwordHash ?? "")) {
    return { ok: false, error: "Usuario o contraseña incorrectos." };
  }

  // Roles del usuario (UsuarioRol -> Rol). Elegimos el primero que mapee a un módulo.
  const rr = await pool.request().input("id", sql.Int, row.idUsuario).query(
    "SELECT ur.idRol, ro.nombre FROM dbo.UsuarioRol ur " +
    "JOIN dbo.Rol ro ON ro.idRol = ur.idRol WHERE ur.idUsuario = @id"
  );
  let role: Role | undefined;
  let idRol = 0;
  let rolNombre = "";
  // Un usuario puede tener roles en varias apps (p.ej. Kathya: "Contabilidad" en
  // Compras y "Facturador Bodega" en Administración). Elegimos por PRIORIDAD para
  // que el rol específico de Compras gane (Contabilidad sobre Bodega, etc.), en vez
  // de tomar el primero que aparezca.
  const PRIORIDAD: Role[] = ["contabilidad", "aprobacion", "proveeduria", "ingenieria", "facturacion"];
  let best: { role: Role; idRol: number; nombre: string } | null = null;
  for (const x of rr.recordset) {
    const m = moduloDeRol(x.idRol, x.nombre);
    if (!m) continue;
    if (!best || PRIORIDAD.indexOf(m) < PRIORIDAD.indexOf(best.role)) best = { role: m, idRol: x.idRol, nombre: x.nombre };
  }
  if (best) { role = best.role; idRol = best.idRol; rolNombre = best.nombre; }
  if (!role) return { ok: false, error: "Tu usuario no tiene un rol con acceso a este sistema." };

  return { ok: true, user: { username: row.username, nombre: row.username, role, idRol, rolNombre } };
}
