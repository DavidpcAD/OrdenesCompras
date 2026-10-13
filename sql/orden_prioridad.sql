-- ============================================================================
--  PRIORIDAD de la orden de compra.
--
--  Qué tan urgente es la orden: la marca Proveeduría al armarla (un segmentado
--  Normal / Alta / Urgente) y la ve Aprobación al revisar, como distintivo junto
--  al estado. Es para ordenar el trabajo de ESTE lado: NO viaja a Business
--  Central. La solicitud (dbo.PedidoCompra.prioridad) ya tenía su propia columna
--  igual; esto es la de la orden.
--
--  Valores: 'normal' | 'alta' | 'urgente'. Se guarda NULL cuando es 'normal' (lo
--  de siempre), así que una fila sin valor se lee como normal y no pinta nada.
--
--  Base: la de compras (hoy AdelantePRO; ver la memoria del proyecto).
--  Idempotente: se puede correr las veces que sea. Mientras no esté corrida, la
--  app funciona igual y la prioridad simplemente no se guarda (todas se ven como
--  normales); el código tolera que la columna no exista (ensurePrioridad en
--  lib/repo.ts).
-- ============================================================================

IF COL_LENGTH('dbo.OrdenCompra', 'prioridad') IS NULL
BEGIN
  ALTER TABLE dbo.OrdenCompra ADD prioridad NVARCHAR(20) NULL;
  PRINT 'dbo.OrdenCompra.prioridad creada.';
END
ELSE
  PRINT 'dbo.OrdenCompra.prioridad ya existía: no se hizo nada.';
GO

-- Para ver las urgentes/altas:
--   SELECT ordenNo, prioridad FROM dbo.OrdenCompra
--   WHERE esEliminada = 0 AND prioridad IN ('alta','urgente')
--   ORDER BY idOrdenCompra DESC;
