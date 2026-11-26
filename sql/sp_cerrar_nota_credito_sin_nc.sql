-- ============================================================================
-- Proc: cerrar una nota de crédito SIN aplicar NC, con motivo (desde Digitación)
-- ----------------------------------------------------------------------------
-- No toda línea que Bodega marca termina en una NC. Caso real (2026-11-16): pedido
-- por 15, el proveedor entregó 7 y FACTURÓ 7 → no hay nada que acreditar. Antes la
-- única salida era "Marcar aplicada" aunque no existiera ninguna NC.
--
-- Este proc, de forma ATÓMICA:
--   1) Deja la línea en estado 'resuelta' (sale de pendientes en Digitación y en
--      Contabilidad de Compras, igual que una aplicada) y guarda el motivo en
--      dbo.NotaCreditoDet.cierreMotivo (NOT NULL = cerrada sin NC).
--   2) Deja el rastro en dbo.Movimiento (tipo 'nc_cerrada') con el motivo.
--
-- Solo cierra líneas PENDIENTES: si otro usuario ya la aplicó o cerró, THROW 50002
-- (Digitación lo muestra como conflicto). Para deshacer, Digitación reabre con
-- sp_MarcarNotaCreditoAplicada @aplicar = 0, que también borra el motivo.
--
-- Uso desde Digitación:
--   EXEC dbo.sp_CerrarNotaCreditoSinNC @idNotaCreditoDet = 123,
--        @usuario = N'jessie.cordero', @rol = N'digitacion',
--        @motivo = N'Se facturó solo lo entregado; no requiere NC';
--
-- Requiere la columna dbo.NotaCreditoDet.cierreMotivo (sql/notas_credito.sql).
-- Idempotente (CREATE OR ALTER). La corre David en AdelantePRO.
-- ============================================================================
CREATE OR ALTER PROCEDURE dbo.sp_CerrarNotaCreditoSinNC
  @idNotaCreditoDet INT,
  @usuario          NVARCHAR(100),
  @rol              NVARCHAR(20)  = N'digitacion',
  @motivo           NVARCHAR(300)
AS
BEGIN
  SET NOCOUNT ON;

  SET @motivo = LTRIM(RTRIM(ISNULL(@motivo, N'')));
  IF LEN(@motivo) = 0
    THROW 50003, 'Falta el motivo del cierre.', 1;

  BEGIN TRY
    BEGIN TRAN;

    -- Datos de la línea (para la bitácora). Bloquea la fila mientras dura la TX.
    DECLARE @idOrdenCompra INT, @ordenNo NVARCHAR(50), @descripcion NVARCHAR(200), @estado NVARCHAR(20);
    SELECT @idOrdenCompra = nc.idOrdenCompra,
           @ordenNo       = o.ordenNo,
           @descripcion   = nc.descripcion,
           @estado        = nc.estado
      FROM dbo.NotaCreditoDet nc WITH (UPDLOCK, ROWLOCK)
      LEFT JOIN dbo.OrdenCompra o ON o.idOrdenCompra = nc.idOrdenCompra
     WHERE nc.idNotaCreditoDet = @idNotaCreditoDet
       AND ISNULL(nc.esEliminada, 0) = 0;

    IF @idOrdenCompra IS NULL
      THROW 50001, 'Nota de crédito no encontrada o eliminada.', 1;

    IF @estado <> N'pendiente'
      THROW 50002, 'La nota de crédito ya no está pendiente.', 1;

    -- 1) Mismo estado que una aplicada + el motivo que la distingue.
    UPDATE dbo.NotaCreditoDet
       SET estado = N'resuelta',
           cierreMotivo = @motivo
     WHERE idNotaCreditoDet = @idNotaCreditoDet;

    -- 2) Rastro en la bitácora de Compras.
    INSERT dbo.Movimiento (entidad, idEntidad, documentoNo, tipoMovimiento, detalle, usuario, rol, fecha)
    VALUES (N'orden', @idOrdenCompra, ISNULL(@ordenNo, N''), N'nc_cerrada',
            LEFT(ISNULL(@descripcion, N'') + N' · Cerrada sin NC: ' + @motivo + N' · desde Digitación', 3900),
            @usuario, @rol, getdate());

    COMMIT TRAN;
  END TRY
  BEGIN CATCH
    IF @@TRANCOUNT > 0 ROLLBACK TRAN;
    THROW;
  END CATCH
END
