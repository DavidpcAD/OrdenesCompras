// LO QUE EL MOTOR DICE NO SE LE MUESTRA A NADIE.
//
// Un error de mssql trae servidor, base y puerto ("Failed to connect to
// mysqladelante.database.windows.net:1433") o, en los de consulta, el nombre de la
// tabla y la columna: le cuenta la infraestructura a cualquiera que abra la app.
// /api/bootstrap ya lo cuidaba a mano; esto es la misma decisión, en un solo lugar
// y reusable.
//
// Lo que NO se toca son los errores que lanza NUESTRO código ("Faltan usuario, tabla
// o nombre", "ya hay una factura con ese número"): esos son los que dicen qué hacer
// y son justamente los que la gente necesita leer. Por eso el filtro mira de dónde
// viene el error y no qué tan feo se ve.
const DE_MSSQL = new Set(["ConnectionError", "RequestError", "TransactionError", "PreparedStatementError"]);
const CODIGOS = /^(ESOCKET|ELOGIN|ETIMEOUT|ECONNCLOSED|ENOTOPEN|EREQUEST|EALREADYCONNECTED|EINSTLOOKUP|ENOCONN)$/;

export function vieneDelMotor(e: unknown): boolean {
  const x = e as { name?: unknown; code?: unknown; message?: unknown } | null;
  if (!x) return false;
  if (DE_MSSQL.has(String(x.name ?? ""))) return true;
  if (CODIGOS.test(String(x.code ?? ""))) return true;
  // Último recurso: el texto. mssql envuelve algunos fallos en Error pelado.
  return /failed to connect|:1433\b|\bmssql\b/i.test(String(x.message ?? ""));
}

// `queFallo` se escribe en pasado y sin punto: "No se pudo guardar la vista".
export function mensajeParaPantalla(e: unknown, queFallo: string): string {
  if (vieneDelMotor(e)) return `${queFallo}: la base no contestó. Reintentá y, si sigue, avisale a TI.`;
  const m = String((e as { message?: unknown })?.message ?? e ?? "").trim();
  return m ? `${queFallo}: ${m}` : `${queFallo}.`;
}

// La misma decisión, pero SIN la frase de adelante: para las rutas cuyo cliente ya
// arma el "No se pudo tal cosa: …" por su cuenta y volvería a ponerlo. Si el error no
// viene del motor devuelve exactamente lo que devolvía antes, así que cambiarlo en
// una ruta no toca ningún mensaje de negocio ni los que llegan de Business Central.
export function mensajeSeguro(e: unknown): string {
  if (vieneDelMotor(e)) return "la base no contestó. Reintentá y, si sigue, avisale a TI";
  return String((e as { message?: unknown })?.message ?? e);
}
