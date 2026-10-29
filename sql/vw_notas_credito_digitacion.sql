-- ============================================================================
-- Vista: Notas de crédito para la app de Digitación (Producción)
-- ----------------------------------------------------------------------------
-- Las notas de crédito las marca BODEGA en Compras Adelante, por línea, sobre una
-- factura recibida que vino MAL (dañado / menos cantidad / precio distinto / llegó
-- otro material). Se guardan en dbo.NotaCreditoDet (ver sql/notas_credito.sql).
--
-- La app de Digitación (otra app, misma base AdelantePRO) necesita LEER esas líneas
-- para mostrar una pantalla "Nota de crédito" al rol "digitación general" (el rol
-- "digitación maderas" NO ve esta pantalla; el gate es por ROL en Digitación, no por
-- almacén, por eso esta vista NO filtra por locationCode).
--
-- Contrato de SOLO LECTURA. Para marcar una NC como aplicada (o reabrirla), Digitación
-- llama al proc dbo.sp_MarcarNotaCreditoAplicada (ver sql/sp_marcar_nota_credito_aplicada.sql):
--     EXEC dbo.sp_MarcarNotaCreditoAplicada @idNotaCreditoDet=@id, @usuario=@u, @rol=N'digitacion', @aplicar=1;
-- Ese proc cambia el estado (el MISMO que usa Contabilidad en Compras: una NC = un solo
-- ciclo) y deja el rastro en la bitácora de Compras (dbo.Movimiento), de forma atómica.
--
-- El link a la factura en BC lo arma Digitación con el bcNo (ver el mensaje de
-- entrega): page=146 (Posted Purchase Invoices) filtrado por 'Order No.' IS '{bcNo}'.
--
-- Idempotente (CREATE OR ALTER). La corre David en AdelantePRO.
-- ============================================================================
CREATE OR ALTER VIEW dbo.vw_NotasCredito_Digitacion
AS
SELECT
  nc.idNotaCreditoDet,                -- id de la línea de NC (clave para marcar aplicada)
  nc.idOrdenCompra,
  o.ordenNo,                          -- Nº interno de la orden (CP-…)
  o.bcNo,                             -- Nº del pedido en BC (para armar el link; NULL si aún no se creó)
  nc.idOrdenCompraDet,                -- línea de la orden (puede ser NULL)
  od.locationCode,                    -- almacén de la línea (informativo; NO se filtra acá)
  nc.articuloNo,
  nc.descripcion,
  nc.motivo,                          -- danado | menos_cantidad | precio_distinto | material_distinto
  nc.cantidad,
  nc.precioUnitario,
  nc.nota,
  nc.estado,                          -- 'pendiente' | 'resuelta' (resuelta = ya aplicada)
  nc.fechaCreacion,
  nc.creadoPor                        -- usuario de Bodega que la marcó
FROM dbo.NotaCreditoDet nc
LEFT JOIN dbo.OrdenCompra    o  ON o.idOrdenCompra     = nc.idOrdenCompra
LEFT JOIN dbo.OrdenCompraDet od ON od.idOrdenCompraDet = nc.idOrdenCompraDet
WHERE ISNULL(nc.esEliminada, 0) = 0;
