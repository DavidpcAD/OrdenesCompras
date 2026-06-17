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
      poolPromise = new sql.ConnectionPool(conn).connect();
    } else {
      const config: sql.config = {
        server: process.env.SQL_SERVER ?? "",
        database: process.env.SQL_DATABASE ?? "",
        user: process.env.SQL_USER ?? "",
        password: process.env.SQL_PASSWORD ?? "",
        options: { encrypt: true, trustServerCertificate: false },
        pool: { max: 10, min: 0, idleTimeoutMillis: 30000 },
      };
      poolPromise = new sql.ConnectionPool(config).connect();
    }
  }
  return poolPromise;
}

export { sql };
