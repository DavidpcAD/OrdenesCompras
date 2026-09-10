-- ============================================================================
-- N.º MÁQUINA DE LA LÍNEA DE LA ORDEN (parque de maquinaria de Goom, GomEqp)
--
-- El repuesto se compra PARA UNA MÁQUINA, y en Business Central ese dato vive en
-- la LÍNEA del pedido de compra ("N.º máquina", Purchase Line."GomEqp Machine
-- No.", Code[20]), no en el encabezado: por eso tres filtros para tres máquinas
-- son TRES LÍNEAS de 1 y no una de 3 — en una sola línea el costo queda sin dueño
-- y ninguna máquina tiene su historial.
--
-- La solicitud ya lo guardaba (dbo.PedidoCompraDet.maquinaNo, NVARCHAR(20)); la
-- ORDEN no tenía dónde, así que la máquina que Proveeduría elegía se perdía en el
-- primer viaje por SQL: no volvía a la pantalla al reabrir la orden, no se copiaba
-- al pasar el pendiente a una orden nueva y no había de dónde sacarla para
-- mandarla a BC. Esta columna cierra ese hueco, con el MISMO tipo que la de la
-- solicitud para que el dato viaje sin recortarse.
--
-- Solo el N.º: el NOMBRE de la máquina ("Excavadora CAT 320") es rótulo de
-- pantalla, se resuelve contra el catálogo de BC y no se guarda acá — guardado se
-- volvería mentira el día que en el parque le cambien el nombre.
--
-- Ejecutar una sola vez en la base de la app (AdelantePRO). Lo corre David.
-- dbo.OrdenCompraDet la COMPARTE la app de Producción: por eso el script es
-- ADITIVO y no toca nada más — una columna nueva NULL que nadie más nombra.
-- Idempotente: se puede correr las veces que sea.
--
-- La app aguanta que la columna NO exista (ver ensureMaquinaCol en lib/repo.ts):
-- las órdenes se crean y se editan igual, lo único que se pierde es la máquina.
-- ============================================================================
IF COL_LENGTH('dbo.OrdenCompraDet', 'maquinaNo') IS NULL
BEGIN
  ALTER TABLE dbo.OrdenCompraDet ADD maquinaNo NVARCHAR(20) NULL;
  PRINT 'dbo.OrdenCompraDet.maquinaNo creada.';
END
ELSE
  PRINT 'dbo.OrdenCompraDet.maquinaNo ya existía: no se hizo nada.';
GO

-- Para ver qué se le compró a una máquina:
--   SELECT oc.ordenNo, oc.bcNo, det.itemNo, det.descripcion, det.quantity, det.maquinaNo
--   FROM dbo.OrdenCompraDet det
--   JOIN dbo.OrdenCompra oc ON oc.idOrdenCompra = det.idOrdenCompra
--   WHERE det.maquinaNo = 'MAQ00017' AND oc.esEliminada = 0
--   ORDER BY det.idOrdenCompraDet DESC;
