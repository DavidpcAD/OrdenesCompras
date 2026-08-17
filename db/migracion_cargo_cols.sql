/* ============================================================================
   Guardar el tipo de Cargo de producto (Item Charge de BC) en la orden.

   POR QUÉ: la app obliga a elegir el tipo de cargo (sin tipo, BC rechaza el flete),
   pero dbo.OrdenCompraDet no tenía dónde guardarlo, así que se perdía en el primer
   viaje por SQL. Con estas dos columnas el tipo y el método de reparto sobreviven,
   y "Reintentar lanzar en BC" vuelve a mandar el cargo bien.

   OJO: dbo.OrdenCompraDet la comparte la app de Producción. Son dos columnas
   NULLABLE al final de la tabla (no cambian nada de lo existente), pero conviene
   confirmar que esa app no haga SELECT * con un mapeo estricto antes de correrlo.

   Se puede correr todas las veces que se quiera: no hace nada si ya están.
   Alternativa: poner el App Setting MIGRAR_ESQUEMA=1 y que la app las cree sola.
   ============================================================================ */

IF COL_LENGTH('dbo.OrdenCompraDet', 'chargeNo') IS NULL
  ALTER TABLE dbo.OrdenCompraDet ADD chargeNo NVARCHAR(40) NULL;

IF COL_LENGTH('dbo.OrdenCompraDet', 'chargeMethod') IS NULL
  ALTER TABLE dbo.OrdenCompraDet ADD chargeMethod NVARCHAR(20) NULL;
GO

-- Comprobación
SELECT COL_LENGTH('dbo.OrdenCompraDet','chargeNo')     AS chargeNo_len,
       COL_LENGTH('dbo.OrdenCompraDet','chargeMethod') AS chargeMethod_len;
