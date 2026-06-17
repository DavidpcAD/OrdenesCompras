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
      // La base AdelanteSBX es serverless (auto-pausa): el primer intento debe
      // esperar a que "despierte" (~30-60s), por eso el connectionTimeout alto.
      poolPromise = new sql.ConnectionPool({
        connectionString: conn,
        connectionTimeout: 60000,
        requestTimeout: 60000,
      }).connect();
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

export { sql };
