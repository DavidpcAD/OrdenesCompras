-- ============================================================================
-- DIAGNÓSTICO DE UNA ORDEN: todo lo que la app sabe de ella, en un solo lugar.
--
-- Para qué: cuando una orden y Business Central no dicen lo mismo, la pregunta es
-- SIEMPRE la misma — ¿desde cuándo, y qué pasó en el medio? La app no lo contaba
-- (los avisos de BC vivían en un toast de tres segundos), así que la única forma de
-- reconstruirlo es mirar las líneas, la bitácora y las recepciones juntas.
--
-- Casos que lo motivaron (2 sep 2026):
--   · CP-005172 (orden 46): 7 líneas acá, 6 en la factura registrada CFR-009599.
--     Faltó M06-0116 TORNILLO 1-1/4 P/F, 7.000 UND × ₡3,26 = ₡22.820 (+ ₡2.966,60
--     de IVA). El proveedor facturó ₡171.169,27; BC registró ₡145.382,67.
--   · Orden 38: misma forma, con una línea que además lleva variante.
--
-- Cómo se usa: poné el id de la orden (el de la URL /proveeduria/ordenes/46) o su
-- N.º de BC, y corré todo. Lo que hay que mirar, en orden:
--   (2) ¿la línea que falta en BC existe en SQL, con qué cantidad, unidad y variante?
--   (3) ¿cuándo se le asignó el N.º de BC y quién la movió? (bitácora)
--   (4) ¿en cuántas recepciones entró y con qué factura?
--   (5) ¿la cantidad recibida de la línea sale de una recepción o de ninguna?
-- ============================================================================
DECLARE @idOrden INT = 46;              -- <<< el id de la URL
DECLARE @bcNo    NVARCHAR(20) = NULL;   -- <<< o el N.º de BC (ej. 'CP-005172')

IF @bcNo IS NOT NULL
  SELECT @idOrden = idOrdenCompra FROM dbo.OrdenCompra WHERE bcNo = @bcNo;

-- (1) El encabezado.
SELECT 'ENCABEZADO' AS bloque, o.idOrdenCompra, o.ordenNo, o.bcNo, o.syncedToBc,
       o.proveedorNo, o.proveedorNombre, o.currencyCode, e.codigo AS estado,
       o.fechaEmision, o.fechaCreacion, o.creadoPor, o.fechaModificacion, o.modificadoPor
  FROM dbo.OrdenCompra o
  LEFT JOIN dbo.Estado e ON e.idEstado = o.idEstado
 WHERE o.idOrdenCompra = @idOrden;

-- (2) Las líneas, TAL COMO ESTÁN EN LA BASE.
-- OJO: la app corrige la unidad al LEER (contra el catálogo de BC), así que lo que
-- se ve en pantalla puede no ser esta columna. Lo que viajó a BC salió de acá.
SELECT 'LINEAS' AS bloque, d.idOrdenCompraDet, d.lineNum, d.tipoLinea, d.itemNo,
       d.variantCode, d.descripcion, d.quantity, d.unitOfMeasureCode, d.locationCode,
       d.directUnitCost, d.vatPct, d.lineDiscountPct, d.jobNo, d.taskNo,
       d.quantityRecibida, d.quantityFacturada,
       d.quantity * d.directUnitCost AS importe,
       pc.pedidoNo AS solicitud
  FROM dbo.OrdenCompraDet d
  LEFT JOIN dbo.PedidoCompraDet pcd ON pcd.idPedidoCompraDet = d.idPedidoCompraDet
  LEFT JOIN dbo.PedidoCompra pc ON pc.idPedidoCompra = pcd.idPedidoCompra
 WHERE d.idOrdenCompra = @idOrden
 ORDER BY d.idOrdenCompraDet;

-- (3) La bitácora: quién la movió, cuándo y con qué motivo.
-- Acá se ve si el N.º de BC lo puso esta app al enviarla a aprobación, o si apareció
-- después (la app de Producción lo escribe al aprobar).
SELECT 'BITACORA' AS bloque, m.fecha, m.tipoMovimiento, m.usuario, m.rol, m.detalle,
       ea.codigo AS estadoAnterior, en.codigo AS estadoNuevo
  FROM dbo.Movimiento m
  LEFT JOIN dbo.Estado ea ON ea.idEstado = m.idEstadoAnterior
  LEFT JOIN dbo.Estado en ON en.idEstado = m.idEstadoNuevo
 WHERE m.entidad = 'orden' AND m.idEntidad = @idOrden
 ORDER BY m.fecha, m.idMovimiento;

-- (4) Las recepciones/facturas registradas contra la orden.
-- bcFacturaNo es el N.º que devolvió BC al registrar (columna agregada el 1/9/2026:
-- en las recepciones anteriores viene NULL, y por eso las órdenes viejas hay que
-- cotejarlas contra BC por el N.º de PEDIDO, no por el de factura).
SELECT 'RECEPCIONES' AS bloque, r.idRecepcionCompra, r.recepcionNo, r.numeroFactura,
       r.bcFacturaNo, r.fechaRecepcion, r.fechaRegistro, r.total, r.recibidoPor, r.esEliminada
  FROM dbo.RecepcionCompra r
 WHERE r.idOrdenCompra = @idOrden
 ORDER BY r.idRecepcionCompra;

-- (5) Qué se recibió en cada recepción, línea por línea.
-- Si una línea tiene quantityRecibida > 0 en (2) pero NO aparece acá, la cantidad se
-- movió sin recepción (edición manual o migración) — y eso también hay que saberlo.
SELECT 'RECIBIDO POR LINEA' AS bloque, rd.idRecepcionCompra, r.recepcionNo, r.numeroFactura,
       rd.idOrdenCompraDet, d.itemNo, d.variantCode, d.descripcion, rd.quantityRecibida
  FROM dbo.RecepcionCompraDet rd
  JOIN dbo.RecepcionCompra r ON r.idRecepcionCompra = rd.idRecepcionCompra
  JOIN dbo.OrdenCompraDet d ON d.idOrdenCompraDet = rd.idOrdenCompraDet
 WHERE r.idOrdenCompra = @idOrden
 ORDER BY rd.idRecepcionCompra, rd.idOrdenCompraDet;
