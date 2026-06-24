import crypto from "crypto";
import { getPool, sql } from "./db";
import type { Role } from "./types";

// idRol (dbo.Rol) -> módulo de la app. Los roles no listados NO tienen acceso.
//   1 Administrador      -> aprobación (aprobador, ej. Luis Roberto)
//   3 Ingeniero Residente-> ingeniería (ej. Laura)
//   5 Proveeduría        -> proveeduría (ej. Angie)
//   6 Facturador Bodega  -> bodega/facturación (ej. Kathya)
const ROL_A_MODULO: Record<number, Role> = {
  1: "aprobacion",
  3: "ingenieria",
  5: "proveeduria",
  6: "facturacion",
};

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
  for (const x of rr.recordset) {
    if (ROL_A_MODULO[x.idRol]) { role = ROL_A_MODULO[x.idRol]; idRol = x.idRol; rolNombre = x.nombre; break; }
  }
  if (!role) return { ok: false, error: "Tu usuario no tiene un rol con acceso a este sistema." };

  return { ok: true, user: { username: row.username, nombre: row.username, role, idRol, rolNombre } };
}
