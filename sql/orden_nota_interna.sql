-- ============================================================================
--  Comentario INTERNO de la orden de compra: el mensaje para el aprobador.
--
--  La orden ya tenía `notaCreador`, que son las OBSERVACIONES PARA EL PROVEEDOR:
--  se imprimen al final del PDF que se le manda. Proveeduría necesita además
--  decirle algo al aprobador ("es urgente para la colada del viernes", "el precio
--  subió porque el proveedor cambió la presentación") y eso NO puede salir en el
--  documento del proveedor.
--
--  `notaAprobador` NO se reutiliza a propósito: va en pareja con `aprobadoPor` /
--  `fechaAprobado` / `esAprobado`, o sea que es el comentario QUE ESCRIBE el
--  aprobador. Si Proveeduría escribiera ahí, el día que la app de Aprobación
--  guarde su propio comentario lo pisaría.
--
--  Base: la de compras (hoy AdelantePRO; ver la memoria del proyecto).
--  Idempotente: se puede correr las veces que sea.
-- ============================================================================

IF COL_LENGTH('dbo.OrdenCompra', 'notaInterna') IS NULL
BEGIN
  ALTER TABLE dbo.OrdenCompra ADD notaInterna NVARCHAR(500) NULL;
  PRINT 'dbo.OrdenCompra.notaInterna creada.';
END
ELSE
  PRINT 'dbo.OrdenCompra.notaInterna ya existía: no se hizo nada.';
GO

-- Para verla junto a lo demás de la orden:
--   SELECT ordenNo, notaCreador AS obs_proveedor, notaInterna AS para_aprobador
--   FROM dbo.OrdenCompra WHERE esEliminada = 0 ORDER BY idOrdenCompra DESC;
