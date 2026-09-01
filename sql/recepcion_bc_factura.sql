-- ============================================================================
-- N.º de la factura REGISTRADA EN BUSINESS CENTRAL de cada recepción
--
-- Al registrar la factura, BC devuelve el N.º del documento que quedó registrado
-- allá (su factura de compra registrada). Ese número es el que Contabilidad y
-- Bodega necesitan para encontrar el movimiento en BC — y hasta ahora solo
-- aparecía unos segundos en el aviso de la pantalla: si nadie lo anotaba a mano,
-- se perdía. Con esta columna queda guardado con la recepción y se ve siempre en
-- "Recibidas".
--
-- OJO que NO es el numeroFactura del proveedor (el papel que trae el camión):
-- ese ya se guarda aparte y es el que Bodega escribe. Este lo devuelve BC.
--
-- Ejecutar una sola vez en la base de la app (AdelantePRO).
-- La app aguanta que esta columna NO exista: la recepción se registra igual y
-- simplemente no muestra el N.º de BC (ver colBcFacturaExiste en lib/repo.ts).
-- ============================================================================
IF COL_LENGTH('dbo.RecepcionCompra', 'bcFacturaNo') IS NULL
BEGIN
  ALTER TABLE dbo.RecepcionCompra ADD bcFacturaNo NVARCHAR(50) NULL;
END;
