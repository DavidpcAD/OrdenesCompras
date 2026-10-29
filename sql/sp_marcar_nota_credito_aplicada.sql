-- ============================================================================
-- Proc: marcar una nota de crédito como APLICADA (o reabrirla) desde Digitación
-- ----------------------------------------------------------------------------
-- La app de Digitación (Producción) marca "ya aplicada" una NC que Bodega dejó en
-- Compras. En vez de que Digitación conozca las tablas internas de Compras, llama a
-- este proc, que hace las dos cosas de forma ATÓMICA:
--
--   1) Cambia el estado de la línea (dbo.NotaCreditoDet.estado). Es el MISMO estado
--      que usa Contabilidad en Compras: aplicar acá también la saca de la lista de
--      pendientes de Compras (y reabrir la devuelve). Una NC = un solo ciclo.
--   2) Deja el rastro en dbo.Movimiento (la bitácora de Compras, la misma tabla que
--      ya escriben las dos apps): quién la aplicó, cuándo y desde dónde. Así el
--      "quién/cuándo aplicó" sale en el historial de la orden en Compras.
--
-- Uso desde Digitación:
--   EXEC dbo.sp_MarcarNotaCreditoAplicada @idNotaCreditoDet = 123,
--        @usuario = N'bryan.arauz', @rol = N'digitacion', @aplicar = 1;   -- aplicada
--   EXEC dbo.sp_MarcarNotaCreditoAplicada @idNotaCreditoDet = 123,
--        @usuario = N'bryan.arauz', @aplicar = 0;                          -- reabrir
--
-- Idempotente (CREATE OR ALTER). La corre David en AdelantePRO.
-- ============================================================================
CREATE OR ALTER PROCEDURE dbo.sp_MarcarNotaCreditoAplicada
  @idNotaCreditoDet INT,
  @usuario          NVARCHAR(100),
  @rol              NVARCHAR(20) = N'digitacion',
  @aplicar          BIT          = 1
AS
BEGIN
  SET NOCOUNT ON;

  DECLARE @estado NVARCHAR(20) = CASE WHEN @aplicar = 1 THEN N'resuelta'    ELSE N'pendiente'    END;
  DECLARE @tipo   NVARCHAR(50) = CASE WHEN @aplicar = 1 THEN N'nc_resuelta' ELSE N'nc_reabierta' END;

  BEGIN TRY
    BEGIN TRAN;

    -- Datos de la línea (para la bitácora). Bloquea la fila mientras dura la TX.
    DECLARE @idOrdenCompra INT, @ordenNo NVARCHAR(50), @descripcion NVARCHAR(200);
    SELECT @idOrdenCompra = nc.idOrdenCompra,
           @ordenNo       = o.ordenNo,
           @descripcion   = nc.descripcion
      FROM dbo.NotaCreditoDet nc WITH (UPDLOCK, ROWLOCK)
      LEFT JOIN dbo.OrdenCompra o ON o.idOrdenCompra = nc.idOrdenCompra
     WHERE nc.idNotaCreditoDet = @idNotaCreditoDet
       AND ISNULL(nc.esEliminada, 0) = 0;

    IF @idOrdenCompra IS NULL
      THROW 50001, 'Nota de crédito no encontrada o eliminada.', 1;

    -- 1) Estado compartido con Contabilidad de Compras.
    UPDATE dbo.NotaCreditoDet
       SET estado = @estado
     WHERE idNotaCreditoDet = @idNotaCreditoDet;

    -- 2) Rastro en la bitácora de Compras (dbo.Movimiento). idEstadoAnterior/Nuevo
    --    quedan NULL, igual que como lo registra la app de Compras para las NC.
    INSERT dbo.Movimiento (entidad, idEntidad, documentoNo, tipoMovimiento, detalle, usuario, rol, fecha)
    VALUES (N'orden', @idOrdenCompra, ISNULL(@ordenNo, N''), @tipo,
            LEFT(ISNULL(@descripcion, N'') + N' · desde Digitación', 3900),
            @usuario, @rol, getdate());

    COMMIT TRAN;
  END TRY
  BEGIN CATCH
    IF @@TRANCOUNT > 0 ROLLBACK TRAN;
    THROW;
  END CATCH
END
