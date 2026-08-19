import crypto from "crypto";
import bcrypt from "bcryptjs";
import { getAuthPool, sql } from "./db";
import type { Role } from "./types";

// Rol (dbo.Rol) -> módulo de la app. Los roles que no calzan NO tienen acceso.
// Ingeniería y Aprobación se manejan en la app de producción, no acá.
//   Proveeduría (crea OC)  -> rol con "proveed" / "compra"            -> proveeduria
//   Bodega (recibe)        -> rol con "bodega" / "facturador" / "recib" -> facturacion
//   Contabilidad (NC)      -> rol con "contab"                        -> contabilidad
//
// Se resuelve SOLO por el NOMBRE del rol, nunca por su idRol. Antes había un mapa
// `{5:'proveeduria', 6:'facturacion'}` que se consultaba primero, y eso ataba el
// permiso a un número que no significa lo mismo en cada base: en AdelantePRO el
// idRol 5 es "Digitacion maderas", así que ese mapa le habría abierto Proveeduría
// a los usuarios del app de Digitación. El nombre sí viaja con su significado.
function moduloDeRol(nombre: string): Role | undefined {
  const n = (nombre || "").toLowerCase();
  if (n.includes("contab")) return "contabilidad";
  if (n.includes("bodeg") || n.includes("factur") || n.includes("recib")) return "facturacion";
  if (n.includes("proveed") || n.includes("compra")) return "proveeduria";
  return undefined;
}

// Comparación de contraseña contra el hash guardado. SOLO acepta hashes:
// bcrypt (como guarda ControlUsuarios) o SHA-256 (hex/base64) legado.
// Ya NO se acepta texto plano: una clave guardada sin hashear no autentica.
function passwordOk(input: string, stored: string): boolean {
  if (!stored) return false;
  // bcrypt (así guarda las claves ControlUsuarios): hash empieza con $2a/$2b/$2y.
  if (/^\$2[aby]?\$/.test(stored)) {
    try { return bcrypt.compareSync(input, stored); } catch { return false; }
  }
  // SHA-256 legado (hex o base64). No es texto plano: `stored` debe ser un hash.
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

  // Padrón de usuarios: base de AUTH (DB_*), no la de datos de compras (SQL_*).
  const pool = await getAuthPool();
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
  const PRIORIDAD: Role[] = ["contabilidad", "proveeduria", "facturacion"];
  let best: { role: Role; idRol: number; nombre: string } | null = null;
  for (const x of rr.recordset) {
    const m = moduloDeRol(x.nombre);
    if (!m) continue;
    if (!best || PRIORIDAD.indexOf(m) < PRIORIDAD.indexOf(best.role)) best = { role: m, idRol: x.idRol, nombre: x.nombre };
  }
  if (best) { role = best.role; idRol = best.idRol; rolNombre = best.nombre; }
  if (!role) return { ok: false, error: "Tu usuario no tiene un rol con acceso a este sistema." };

  return { ok: true, user: { username: row.username, nombre: row.username, role, idRol, rolNombre } };
}
