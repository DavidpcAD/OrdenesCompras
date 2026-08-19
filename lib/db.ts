import sql from "mssql";

// Conexión a SQL Server (Azure). Lee la configuración de variables de entorno.
// Definí en .env.local:
//   SQL_SERVER=mysqladelante.database.windows.net
//   SQL_DATABASE=AdelanteSBX
//   SQL_USER=...
//   SQL_PASSWORD=...
// (o, alternativamente, SQL_CONNECTION_STRING con la cadena completa)

let poolPromise: Promise<sql.ConnectionPool> | null = null;

export function getPool(): Promise<sql.ConnectionPool> {
  if (!poolPromise) {
    const conn = process.env.SQL_CONNECTION_STRING;
    if (conn) {
      // Si viene una cadena completa, usamos el overload de string y forzamos
      // timeout de conexión para tolerar el resume de Azure SQL serverless.
      const hasTimeout = /(Connection Timeout|Connect Timeout)\s*=\s*\d+/i.test(conn);
      const suffix = conn.trim().endsWith(";") ? "" : ";";
      const connWithTimeout = hasTimeout ? conn : `${conn}${suffix}Connection Timeout=60;`;
      poolPromise = new sql.ConnectionPool(connWithTimeout).connect();
    } else {
      const config: sql.config = {
        server: process.env.SQL_SERVER ?? "",
        database: process.env.SQL_DATABASE ?? "",
        user: process.env.SQL_USER ?? "",
        password: process.env.SQL_PASSWORD ?? "",
        options: { encrypt: true, trustServerCertificate: false },
        // 60s para tolerar el "resume" de la base serverless en pausa.
        connectionTimeout: 60000,
        requestTimeout: 60000,
        pool: { max: 10, min: 0, idleTimeoutMillis: 30000 },
      };
      poolPromise = new sql.ConnectionPool(config).connect();
    }
    // Si la conexión falla, no dejamos cacheada una promesa rechazada:
    // la reseteamos para que el próximo request reintente (clave con serverless).
    poolPromise.catch(() => {
      poolPromise = null;
    });
  }
  return poolPromise;
}

// Conexión de AUTENTICACIÓN (dbo.Usuario / UsuarioRol / Rol). Va SEPARADA de la de
// datos porque los usuarios y los pedidos/órdenes pueden vivir en bases distintas:
// las tablas de compras se movieron a AdelantePRO pero el padrón de usuarios sigue
// en AdelanteSBX (en PRO solo existen los 7 usuarios del app de Digitación, y ahí
// el idRol 5 es "Digitacion maderas", no "Proveeduría" — leer los roles de la base
// equivocada dejaría a Angie afuera y le abriría proveeduría a quien no es).
//
// Se configura con DB_* y, si no están, cae a SQL_* → mismo comportamiento de antes.
// Pool PROPIO (no el global de mssql) para no chocar con getPool().
let authPoolPromise: Promise<sql.ConnectionPool> | null = null;

export function getAuthPool(): Promise<sql.ConnectionPool> {
  if (!authPoolPromise) {
    const config: sql.config = {
      server: process.env.DB_SERVER ?? process.env.SQL_SERVER ?? "",
      database: process.env.DB_DATABASE ?? process.env.DB_NAME ?? process.env.SQL_DATABASE ?? "",
      user: process.env.DB_USER ?? process.env.SQL_USER ?? "",
      password: process.env.DB_PASSWORD ?? process.env.SQL_PASSWORD ?? "",
      port: parseInt(process.env.DB_PORT ?? "1433"),
      options: { encrypt: true, trustServerCertificate: false },
      // 60s para tolerar el "resume" de la base serverless en pausa.
      connectionTimeout: 60000,
      requestTimeout: 60000,
      pool: { max: 5, min: 0, idleTimeoutMillis: 30000 },
    };
    authPoolPromise = new sql.ConnectionPool(config).connect();
    authPoolPromise.catch(() => {
      authPoolPromise = null;
    });
  }
  return authPoolPromise;
}

export { sql };
