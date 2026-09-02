-- ============================================================================
-- CHEQUEO DE LA ORDEN CONTRA BUSINESS CENTRAL (líneas SQL ↔ líneas del pedido)
--
-- Por qué: el 2 de septiembre de 2026 se descubrió que CP-005172 tenía 7 líneas
-- en la app y 6 en BC. Faltaba "M06-0116 TORNILLO 1-1/4 P/F, 7.000 UND × ₡3,26":
-- ₡22.820 + ₡2.966,60 de IVA que el proveedor facturó (₡171.169,27) y que en BC
-- quedaron registrados de menos (₡145.382,67). El material entró a la bodega y
-- nunca entró al inventario de BC. La app decía "recibido 100%".
--
-- La app avisaba —en un toast que dura tres segundos—. Con estas columnas el
-- resultado del cotejo deja de ser un aviso que se desvanece y pasa a ser un
-- ESTADO de la orden: se ve en el detalle, se puede listar en un reporte y se
-- puede frenar una recepción con él.
--
--   bcCheckEstado   'ok' | 'desalineado' | 'sin-pedido'  (NULL = nunca se chequeó)
--   bcCheckDetalle  el texto de las diferencias, línea por línea
--   bcCheckFecha    cuándo se hizo el cotejo (para saber si está viejo)
--
-- Ejecutar una sola vez en la base de la app (AdelantePRO).
-- dbo.OrdenCompra la COMPARTE la app de Producción: por eso son columnas nuevas
-- NULL y nadie más las toca. La app aguanta que NO existan (ver ensureChequeoBcCols
-- en lib/repo.ts): el cotejo se hace igual y se muestra en el momento, lo único
-- que se pierde es la memoria entre visitas.
-- ============================================================================
IF COL_LENGTH('dbo.OrdenCompra', 'bcCheckEstado') IS NULL
BEGIN
  ALTER TABLE dbo.OrdenCompra ADD bcCheckEstado NVARCHAR(20) NULL;
END;
GO
IF COL_LENGTH('dbo.OrdenCompra', 'bcCheckDetalle') IS NULL
BEGIN
  ALTER TABLE dbo.OrdenCompra ADD bcCheckDetalle NVARCHAR(MAX) NULL;
END;
GO
IF COL_LENGTH('dbo.OrdenCompra', 'bcCheckFecha') IS NULL
BEGIN
  ALTER TABLE dbo.OrdenCompra ADD bcCheckFecha DATETIME2 NULL;
END;
GO

-- Índice de conveniencia para el reporte de conciliación (listar lo desalineado
-- sin recorrer toda la tabla). Filtrado: solo las órdenes que tienen algo que ver.
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_OrdenCompra_bcCheckEstado' AND object_id = OBJECT_ID('dbo.OrdenCompra'))
BEGIN
  CREATE INDEX IX_OrdenCompra_bcCheckEstado
    ON dbo.OrdenCompra (bcCheckEstado)
    WHERE bcCheckEstado IS NOT NULL;
END;
GO
