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

// TAPARLO EN LA PANTALLA NO ES TIRARLO A LA BASURA.
//
// Las dos funciones de abajo devolvían la frase genérica y el error del motor se
// perdía: una captura con "la base no contestó" no dice si fue un timeout, una
// columna que no existe o un dato que no cabe, y sin eso no hay nada que arreglar.
// (5 oct 2026: la orden que Proveeduría no pudo crear se diagnosticó a punta de
// métricas de Azure porque el error no quedó en ninguna parte.)
//
// El crudo va al log del server —Azure → Log Stream—, que es donde SÍ puede decir
// host, puerto, tabla y columna: ahí lo lee quien administra, no quien usa la app.
// Mismo canal y mismo criterio que /api/bootstrap, que ya lo hacía a mano.
function anotarEnElLog(e: unknown, donde: string): void {
  const x = (e ?? {}) as {
    name?: unknown; code?: unknown; number?: unknown; message?: unknown;
    stack?: unknown; originalError?: { message?: unknown };
  };
  // `number` es el error de SQL Server (1205 deadlock, 8152 no cabe, 207 columna que
  // no existe): es el dato que convierte "falló" en "esto fue". `originalError` sale
  // porque mssql envuelve el del driver y a veces el de adentro es el que explica.
  const senas = [
    String(x.name ?? "Error"),
    x.code ? `code=${String(x.code)}` : "",
    x.number != null ? `nro=${String(x.number)}` : "",
  ].filter(Boolean).join(" ");
  const interno = x.originalError?.message && String(x.originalError.message) !== String(x.message ?? "")
    ? ` · driver: ${String(x.originalError.message)}` : "";
  console.error(`[sql] ${donde || "sin rótulo"} · ${senas} · ${String(x.message ?? e)}${interno}`);
  // La pila dice en qué ruta y en qué consulta fue, que es lo que no se puede deducir
  // del mensaje cuando la misma frase sale de 48 lugares distintos.
  if (x.stack) console.error(String(x.stack));
}

// `queFallo` se escribe en pasado y sin punto: "No se pudo guardar la vista".
export function mensajeParaPantalla(e: unknown, queFallo: string): string {
  if (vieneDelMotor(e)) {
    anotarEnElLog(e, queFallo);
    return `${queFallo}: la base no contestó. Reintentá y, si sigue, avisale a TI.`;
  }
  const m = String((e as { message?: unknown })?.message ?? e ?? "").trim();
  return m ? `${queFallo}: ${m}` : `${queFallo}.`;
}

// La misma decisión, pero SIN la frase de adelante: para las rutas cuyo cliente ya
// arma el "No se pudo tal cosa: …" por su cuenta y volvería a ponerlo. Si el error no
// viene del motor devuelve exactamente lo que devolvía antes, así que cambiarlo en
// una ruta no toca ningún mensaje de negocio ni los que llegan de Business Central.
// `donde` es opcional y solo sirve para el log: una ruta que no lo pasa se comporta
// exactamente igual que antes, y la pila ya dice de dónde salió.
export function mensajeSeguro(e: unknown, donde = ""): string {
  if (vieneDelMotor(e)) {
    anotarEnElLog(e, donde);
    return "la base no contestó. Reintentá y, si sigue, avisale a TI";
  }
  return String((e as { message?: unknown })?.message ?? e);
}
