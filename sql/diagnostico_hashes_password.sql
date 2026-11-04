-- SOLO LECTURA. Cuántos usuarios del padrón (AdelantePRO.dbo.Usuario) tienen la
-- contraseña en cada formato. No muestra ningún hash ni ningún nombre.
--
-- Por qué: lib/auth.ts (passwordOk) acepta bcrypt —así guarda ControlUsuarios— y
-- además SHA-256 SIN SAL como formato viejo. Un SHA-256 sin sal se rompe rápido si la
-- tabla se filtra. Si la cuenta de 'sha256-*' da 0, se puede quitar ese camino de
-- passwordOk; si no da 0, esos usuarios tienen que cambiar la clave en ControlUsuarios
-- (que la vuelve a guardar en bcrypt) antes de quitarlo.
--
-- Correr:  sqlcmd -S mysqladelante.database.windows.net -d AdelantePRO -U davidpc -i sql/diagnostico_hashes_password.sql

;WITH f AS (
  SELECT u.idUsuario,
         CASE
           WHEN u.passwordHash IS NULL OR u.passwordHash = '' THEN 'vacio'
           WHEN u.passwordHash LIKE '$2[aby]$%' OR u.passwordHash LIKE '$2$%' THEN 'bcrypt'
           WHEN LEN(u.passwordHash) = 64 AND u.passwordHash NOT LIKE '%[^0-9a-fA-F]%' THEN 'sha256-hex'
           WHEN LEN(u.passwordHash) = 44 AND RIGHT(u.passwordHash, 1) = '=' THEN 'sha256-base64'
           ELSE 'otro'
         END AS formato,
         CASE WHEN EXISTS (
           SELECT 1 FROM dbo.UsuarioRol ur JOIN dbo.Rol ro ON ro.idRol = ur.idRol
            WHERE ur.idUsuario = u.idUsuario
              AND (ro.nombre LIKE '%contab%' OR ro.nombre LIKE '%bodeg%' OR ro.nombre LIKE '%factur%'
                   OR ro.nombre LIKE '%recib%' OR ro.nombre LIKE '%proveed%' OR ro.nombre LIKE '%compra%')
         ) THEN 1 ELSE 0 END AS entraACompras
    FROM dbo.Usuario u
)
SELECT formato, COUNT(*) AS usuarios, SUM(entraACompras) AS conAccesoACompras
  FROM f
 GROUP BY formato
 ORDER BY usuarios DESC;
