-- ============================================================================
-- Plantillas de pedido: tipo (general | bodega)  ·  Compras Adelante
--   general → amarrada a etapa/partida/clasificación (alimenta la matriz).
--   bodega  → solo lista de materiales (p. ej. las cargadas del Excel), sin
--             clasificación.
--
-- Ejecutar una sola vez en la base de la app (AdelanteSBX / Sandbox).
-- El código funciona con o sin esta columna; correrla activa la persistencia
-- del tipo (mientras tanto se infiere: sin clasificación ⇒ bodega).
-- ============================================================================
IF COL_LENGTH('dbo.PlantillaSolicitud', 'tipo') IS NULL
BEGIN
  ALTER TABLE dbo.PlantillaSolicitud
    ADD tipo NVARCHAR(15) NOT NULL
        CONSTRAINT DF_PlantillaSolicitud_tipo DEFAULT ('general');

  -- Filas existentes sin clasificación se marcan como bodega.
  EXEC('UPDATE dbo.PlantillaSolicitud SET tipo = ''bodega'' WHERE idClasificacion IS NULL');
END;
