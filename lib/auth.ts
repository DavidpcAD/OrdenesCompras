import crypto from "crypto";
import bcrypt from "bcryptjs";
import { getAuthPool, sql } from "./db.ts";
import { huellaDeClave } from "./session.ts";
import type { EstadoCuenta } from "./sesion-vigente.ts";
import type { Role } from "./types.ts";

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
//
// bcrypt va en su versión ASÍNCRONA: la síncrona congela el servidor entero ~0,1 s por
// intento, y con alguien probando claves en ráfaga eso tumbaba la app para todos.
async function passwordOk(input: string, stored: string): Promise<boolean> {
  if (!stored) return false;
  // bcrypt (así guarda las claves ControlUsuarios): hash empieza con $2a/$2b/$2y.
  if (/^\$2[aby]?\$/.test(stored)) {
    try { return await bcrypt.compare(input, stored); } catch { return false; }
  }
  // SHA-256 legado (hex o base64). No es texto plano: `stored` debe ser un hash.
  const hex = crypto.createHash("sha256").update(input).digest("hex");
  if (hex.toLowerCase() === stored.toLowerCase()) return true;
  const b64 = crypto.createHash("sha256").update(input).digest("base64");
  if (b64 === stored) return true;
  return false;
}

// `huella` va a la cookie de sesión (ver huellaDeClave en lib/session.ts), NUNCA a la
// respuesta del login ni a la pantalla.
export type AuthUser = { username: string; nombre: string; role: Role; idRol: number; rolNombre: string; huella: string };

// Hash bcrypt de una clave cualquiera. Cuando el usuario NO existe se compara contra
// esto igual, para que "no existe" tarde lo mismo que "clave mala": si no, midiendo el
// tiempo de respuesta se podía averiguar qué usuarios existen y atacar solo esos.
const HASH_SEÑUELO = "$2a$10$s13VSTvG11vHlZ1Ju/14zuJ4/B.BwAJmQ/p62XI/gpVzlwXWpGXZW";

// Un usuario puede tener roles en varias apps (p.ej. Kathya: "Contabilidad" en
// Compras y "Facturador Bodega" en Administración). Elegimos por PRIORIDAD para
// que el rol específico de Compras gane (Contabilidad sobre Bodega, etc.), en vez
// de tomar el primero que aparezca. Lo usan el login Y la revisión periódica de la
// sesión: si eligieran distinto, la revisión creería que te cambiaron el rol.
async function rolDeUsuario(pool: sql.ConnectionPool, idUsuario: number): Promise<{ role: Role; idRol: number; nombre: string } | null> {
  const rr = await pool.request().input("id", sql.Int, idUsuario).query(
    "SELECT ur.idRol, ro.nombre FROM dbo.UsuarioRol ur " +
    "JOIN dbo.Rol ro ON ro.idRol = ur.idRol WHERE ur.idUsuario = @id"
  );
  const PRIORIDAD: Role[] = ["contabilidad", "proveeduria", "facturacion"];
  let best: { role: Role; idRol: number; nombre: string } | null = null;
  for (const x of rr.recordset) {
    const m = moduloDeRol(x.nombre);
    if (!m) continue;
    if (!best || PRIORIDAD.indexOf(m) < PRIORIDAD.indexOf(best.role)) best = { role: m, idRol: x.idRol, nombre: x.nombre };
  }
  return best;
}

// Cómo está HOY la cuenta en el padrón: si existe, la huella de su contraseña actual
// y el módulo que le toca. Es lo que lib/sesion-vigente.ts compara contra la cookie
// para cortar una sesión abierta cuando cambian la clave, el rol o borran al usuario.
export async function estadoDeCuenta(username: string): Promise<EstadoCuenta> {
  const pool = await getAuthPool();
  const r = await pool.request().input("u", sql.NVarChar(100), (username ?? "").trim()).query(
    "SELECT TOP 1 idUsuario, passwordHash FROM dbo.Usuario WHERE username = @u"
  );
  const row = r.recordset[0];
  if (!row) return { existe: false };
  const rol = await rolDeUsuario(pool, row.idUsuario);
  return { existe: true, huella: await huellaDeClave(row.passwordHash ?? ""), role: rol?.role };
}

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
  if (!row) {
    await passwordOk(password, HASH_SEÑUELO);   // mismo tiempo que una clave mala
    return { ok: false, error: "Usuario o contraseña incorrectos." };
  }
  if (!(await passwordOk(password, row.passwordHash ?? ""))) {
    return { ok: false, error: "Usuario o contraseña incorrectos." };
  }

  // Roles del usuario (UsuarioRol -> Rol): el que mapee a un módulo, por prioridad.
  const best = await rolDeUsuario(pool, row.idUsuario);
  if (!best) return { ok: false, error: "Tu usuario no tiene un rol con acceso a este sistema." };
  const { role, idRol, nombre: rolNombre } = best;
  const huella = await huellaDeClave(row.passwordHash ?? "");

  return { ok: true, user: { username: row.username, nombre: row.username, role, idRol, rolNombre, huella } };
}
