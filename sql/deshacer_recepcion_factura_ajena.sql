/* ============================================================================
   Deshacer una recepción que la app guardó enlazada a una factura de BC AJENA
   (de otro pedido, o anulada con una nota de crédito correctiva).

   CAUSA (arreglada en el PR #39, lib/factura-ajena.ts): cuando BC contestaba
   «Purchase Invoice X already exists for this vendor», la app lo tomaba como
   prueba de que la recepción ya estaba registrada y ofrecía «Guardar la
   recepción acá». BC no deja repetir el N.º de factura del proveedor aunque la
   factura original sea de otro pedido o esté anulada, así que la recepción quedó
   guardada SOLO en la app: la orden sale «Completada» y en BC el pedido sigue
   sin nada recibido.

   QUÉ HACE, para la orden con N.º de BC = bcNo:
     1. Marca como eliminadas (esEliminada=1) las recepciones vivas enlazadas a
        la factura de BC bcFactura. No borra filas: quedan para la historia.
     2. Les resta a las líneas de la orden lo recibido y facturado por esas
        recepciones (quantityRecibida / quantityFacturada).
     3. Si la orden estaba Completada, la deja en el MISMO estado que tiene hoy
        el pedido en BC (estadoBc), para que app y BC no se contradigan:
          - Lanzado: Bodega o Contabilidad la registran directo («Recibir y
            facturar») con el N.º de factura nuevo.
          - Abierto: Proveeduría la manda a aprobación desde la app; la app la
            relanza en BC y después se registra con el N.º de factura nuevo.
        estadoBc se mira en BC antes de correr esto (el script no lee BC).
     4. Deja el porqué en la bitácora de la orden y de la recepción.

   ANTES DE CORRERLO: confirmar en BC que el pedido no tiene nada recibido de lo
   que se va a quitar. Este script solo corrige la app; no toca BC.

   CÓMO SE CORRE (sqlcmd). Siempre primero con aplicar=0: hace todo dentro de una
   transacción, muestra cómo quedaría y lo DESHACE. Con aplicar=1 lo guarda.

     sqlcmd -S <servidor> -d AdelantePRO -U <usuario> -W -s "|" -b \
       -i sql/deshacer_recepcion_factura_ajena.sql \
       -v bcNo=CP-000000 -v bcFactura=CFR-000000 -v estadoBc=Lanzado -v aplicar=0

   estadoBc es obligatorio (Lanzado o Abierto). Si falta, sqlcmd no corre nada.

   Idempotente: si ya se corrió (o no hay recepción viva con esa factura), avisa
   y no cambia nada.
   ============================================================================ */
SET NOCOUNT ON;
SET XACT_ABORT ON;

DECLARE @bcNo      NVARCHAR(20) = N'$(bcNo)';
DECLARE @bcFactura NVARCHAR(50) = UPPER(LTRIM(RTRIM(N'$(bcFactura)')));
DECLARE @estadoBc  NVARCHAR(20) = LTRIM(RTRIM(N'$(estadoBc)'));
DECLARE @aplicar   BIT          = $(aplicar);
DECLARE @msg       NVARCHAR(400);

-- Freno de dedo: los dos números tienen que tener forma de documento de BC
-- (LETRAS-dígitos). Vacío, la búsqueda de abajo agarraría recepciones sin factura.
IF @bcNo NOT LIKE N'[A-Z]%-[0-9]%' OR @bcFactura NOT LIKE N'[A-Z]%-[0-9]%'
  THROW 50000, N'bcNo y bcFactura tienen que ser N.º de documento de BC (por ejemplo CP-000000 y CFR-000000). No se tocó nada.', 1;

-- El estado del pedido en BC lo dice quien corre el script: solo esos dos.
IF @estadoBc NOT IN (N'Lanzado', N'Abierto')
  THROW 50004, N'estadoBc tiene que ser Lanzado o Abierto (el estado que tiene hoy el pedido en BC). No se tocó nada.', 1;

-- ---------------------------------------------------------------------------
-- La orden: tiene que ser UNA sola y viva.
-- ---------------------------------------------------------------------------
DECLARE @idOrden INT, @ordenNo NVARCHAR(50), @n INT;
SELECT @n = COUNT(*) FROM dbo.OrdenCompra WHERE bcNo = @bcNo AND esEliminada = 0;
IF @n <> 1
BEGIN
  SET @msg = CONCAT(N'Se esperaba 1 orden viva con N.º de BC ', @bcNo, N' y hay ', @n, N'. No se tocó nada.');
  THROW 50001, @msg, 1;
END;
SELECT @idOrden = idOrdenCompra, @ordenNo = COALESCE(NULLIF(LTRIM(RTRIM(ordenNo)), ''), @bcNo)
  FROM dbo.OrdenCompra WHERE bcNo = @bcNo AND esEliminada = 0;

-- Las recepciones a quitar: vivas, de esta orden, enlazadas a esa factura de BC.
DECLARE @recs TABLE (idRecepcionCompra INT PRIMARY KEY, recepcionNo NVARCHAR(50), numeroFactura NVARCHAR(40), facturada BIT);
INSERT @recs
SELECT r.idRecepcionCompra, r.recepcionNo, LTRIM(RTRIM(ISNULL(r.numeroFactura, ''))),
       CASE WHEN LTRIM(RTRIM(ISNULL(r.numeroFactura, ''))) <> '' THEN 1 ELSE 0 END
  FROM dbo.RecepcionCompra r
 WHERE r.idOrdenCompra = @idOrden
   AND r.esEliminada = 0
   -- bcFacturaNo puede traer varias separadas por coma ("CFR-1, CFR-2"): se busca
   -- la factura como elemento entero, no como pedazo de otro número.
   AND (N',' + UPPER(REPLACE(ISNULL(r.bcFacturaNo, ''), N' ', N'')) + N',') LIKE (N'%,' + @bcFactura + N',%');

-- ---------------------------------------------------------------------------
-- ANTES: cómo está hoy.
-- ---------------------------------------------------------------------------
SELECT 'ORDEN (antes)' AS bloque, o.idOrdenCompra, o.ordenNo, o.bcNo, e.estado
  FROM dbo.OrdenCompra o LEFT JOIN dbo.Estado e ON e.idEstado = o.idEstado
 WHERE o.idOrdenCompra = @idOrden;

SELECT 'RECEPCIONES (antes)' AS bloque, r.idRecepcionCompra, r.recepcionNo, r.numeroFactura, r.bcFacturaNo,
       r.fechaRecepcion, r.total, r.creadoPor, r.esEliminada,
       CASE WHEN x.idRecepcionCompra IS NOT NULL THEN 'SE QUITA' ELSE '' END AS accion
  FROM dbo.RecepcionCompra r
  LEFT JOIN @recs x ON x.idRecepcionCompra = r.idRecepcionCompra
 WHERE r.idOrdenCompra = @idOrden
 ORDER BY r.idRecepcionCompra;

IF NOT EXISTS (SELECT 1 FROM @recs)
BEGIN
  PRINT CONCAT(N'Nada que hacer: ', @bcNo, N' no tiene ninguna recepción viva enlazada a ', @bcFactura,
               N' (o ya se corrió este script). No se tocó nada.');
  RETURN;
END;

-- Lo que hay que restarle a cada línea de la orden.
DECLARE @resta TABLE (idOrdenCompraDet INT PRIMARY KEY, recibida DECIMAL(18, 4), facturada DECIMAL(18, 4));
INSERT @resta
SELECT rd.idOrdenCompraDet,
       SUM(rd.quantityRecibida),
       SUM(CASE WHEN x.facturada = 1 THEN rd.quantityRecibida ELSE 0 END)
  FROM dbo.RecepcionCompraDet rd
  JOIN @recs x ON x.idRecepcionCompra = rd.idRecepcionCompra
 GROUP BY rd.idOrdenCompraDet;

SELECT 'LINEAS (antes → después)' AS bloque, d.idOrdenCompraDet, d.itemNo, d.descripcion, d.quantity,
       ISNULL(d.quantityRecibida, 0)  AS recibidaAntes,  ISNULL(d.quantityRecibida, 0)  - ISNULL(s.recibida, 0)  AS recibidaDespues,
       ISNULL(d.quantityFacturada, 0) AS facturadaAntes, ISNULL(d.quantityFacturada, 0) - ISNULL(s.facturada, 0) AS facturadaDespues
  FROM dbo.OrdenCompraDet d
  LEFT JOIN @resta s ON s.idOrdenCompraDet = d.idOrdenCompraDet
 WHERE d.idOrdenCompra = @idOrden
 ORDER BY d.idOrdenCompraDet;

-- Freno: ninguna línea puede quedar en negativo. Si pasa, la orden se movió por
-- otro lado y hay que mirarla a mano (sql/diagnostico_orden.sql).
IF EXISTS (SELECT 1 FROM dbo.OrdenCompraDet d JOIN @resta s ON s.idOrdenCompraDet = d.idOrdenCompraDet
            WHERE ISNULL(d.quantityRecibida, 0) - s.recibida < -0.0001
               OR ISNULL(d.quantityFacturada, 0) - s.facturada < -0.0001)
  THROW 50002, N'Alguna línea quedaría con recibido o facturado negativo. No se tocó nada: revisar con sql/diagnostico_orden.sql.', 1;

-- Estados (dbo.Estado es compartida con otras apps: solo el módulo Compras).
-- OJO: hay nombres REPETIDOS en Compras (Completado = 9 y 10, Lanzado = 7 y 8, desde
-- la migración). La app escribe el id MAYOR (lib/repo.ts → ensureEstados: el último
-- que lee gana), así que se escribe ese; y "estaba Completada" se pregunta por el
-- NOMBRE, no por un id, para que valga con cualquiera de los dos.
DECLARE @idCompletado INT = (SELECT MAX(idEstado) FROM dbo.Estado WHERE estado = N'Completado' AND modulo = 'Compras');
DECLARE @idAbierto    INT = (SELECT MAX(idEstado) FROM dbo.Estado WHERE estado = N'Abierto'    AND modulo = 'Compras');
DECLARE @idLanzado    INT = (SELECT MAX(idEstado) FROM dbo.Estado WHERE estado = N'Lanzado'    AND modulo = 'Compras');
IF @idCompletado IS NULL OR @idAbierto IS NULL OR @idLanzado IS NULL
  THROW 50003, N'No se encontraron los estados Completado / Abierto / Lanzado del módulo Compras. No se tocó nada.', 1;

DECLARE @recepcionesTxt NVARCHAR(400) = (
  SELECT STRING_AGG(CONCAT(recepcionNo, CASE WHEN numeroFactura <> '' THEN CONCAT(N' (factura ', numeroFactura, N')') END), N', ')
    FROM @recs);
DECLARE @quien NVARCHAR(100) = LEFT(SUSER_SNAME(), 100);

-- ---------------------------------------------------------------------------
-- LA CORRECCIÓN, en una sola transacción.
-- ---------------------------------------------------------------------------
BEGIN TRANSACTION;

  -- 1. Las recepciones quedan eliminadas (la fila y sus líneas se conservan).
  UPDATE r SET r.esEliminada = 1
    FROM dbo.RecepcionCompra r JOIN @recs x ON x.idRecepcionCompra = r.idRecepcionCompra;

  -- 2. Las líneas de la orden vuelven a tener pendiente lo que esas recepciones decían.
  UPDATE d SET d.quantityRecibida  = ISNULL(d.quantityRecibida, 0)  - s.recibida,
               d.quantityFacturada = ISNULL(d.quantityFacturada, 0) - s.facturada
    FROM dbo.OrdenCompraDet d JOIN @resta s ON s.idOrdenCompraDet = d.idOrdenCompraDet;

  -- 3. El estado: solo si estaba Completada, y queda igual que el pedido en BC.
  DECLARE @idEstadoAntes INT = (SELECT idEstado FROM dbo.OrdenCompra WHERE idOrdenCompra = @idOrden);
  DECLARE @idEstadoNuevo INT = NULL;
  IF EXISTS (SELECT 1 FROM dbo.Estado WHERE idEstado = @idEstadoAntes AND estado = N'Completado' AND modulo = 'Compras')
    SET @idEstadoNuevo = CASE WHEN @estadoBc = N'Lanzado' THEN @idLanzado ELSE @idAbierto END;
  IF @idEstadoNuevo IS NOT NULL
    UPDATE dbo.OrdenCompra
       SET idEstado = @idEstadoNuevo, fechaModificacion = getdate(), modificadoPor = @quien
     WHERE idOrdenCompra = @idOrden;

  -- 4. La bitácora, en el mismo formato que escribe la app (lib/repo.ts → logMov).
  DECLARE @detalle NVARCHAR(MAX) = CONCAT(
    N'Se quitó la recepción ', @recepcionesTxt, N': quedó guardada solo en la app, enlazada a ', @bcFactura,
    N', una factura de Business Central de otro pedido o anulada. En BC este pedido no tiene nada recibido. ',
    CASE WHEN @idEstadoNuevo = @idAbierto
         THEN N'La orden vuelve a Abierto, como el pedido en BC: mandala a aprobación para que se lance y registrá la factura con otro N.º.'
         WHEN @idEstadoNuevo = @idLanzado
         THEN N'La orden vuelve a Lanzado, como el pedido en BC: registrá la factura con otro N.º («Recibir y facturar»).'
         ELSE N'Registrá la factura con otro N.º.' END);

  INSERT dbo.Movimiento (entidad, idEntidad, documentoNo, tipoMovimiento, idEstadoAnterior, idEstadoNuevo, detalle, usuario, rol, fecha)
  VALUES ('orden', @idOrden, @ordenNo, 'reabierto', @idEstadoAntes, @idEstadoNuevo, @detalle, @quien, 'proveeduria', getdate());

  INSERT dbo.Movimiento (entidad, idEntidad, documentoNo, tipoMovimiento, idEstadoAnterior, idEstadoNuevo, detalle, usuario, rol, fecha)
  SELECT 'recepcion', x.idRecepcionCompra, COALESCE(NULLIF(x.numeroFactura, ''), x.recepcionNo), 'eliminado', NULL, NULL, @detalle, @quien, 'proveeduria', getdate()
    FROM @recs x;

  -- DESPUÉS: cómo queda.
  SELECT 'ORDEN (después)' AS bloque, o.idOrdenCompra, o.ordenNo, o.bcNo, e.estado
    FROM dbo.OrdenCompra o LEFT JOIN dbo.Estado e ON e.idEstado = o.idEstado
   WHERE o.idOrdenCompra = @idOrden;

  SELECT 'RECEPCIONES (después)' AS bloque, r.idRecepcionCompra, r.recepcionNo, r.numeroFactura, r.bcFacturaNo, r.esEliminada
    FROM dbo.RecepcionCompra r
   WHERE r.idOrdenCompra = @idOrden
   ORDER BY r.idRecepcionCompra;

IF @aplicar = 1
BEGIN
  COMMIT TRANSACTION;
  PRINT CONCAT(N'APLICADO: ', @bcNo, N' quedó lista para volver a registrarse. ',
               CASE WHEN @idEstadoNuevo IS NULL
                    THEN N'El estado de la orden no se tocó (no estaba Completada).'
                    ELSE CONCAT(N'Estado en la app: ', @estadoBc, N', como en BC.') END);
END
ELSE
BEGIN
  ROLLBACK TRANSACTION;
  PRINT N'PRUEBA (aplicar=0): esto es lo que haría. Se deshizo todo; para guardarlo, correr con aplicar=1.';
END;
