-- ============================================================================
--  Mapeo INGENIERO -> OBRA(s)  (por dónde arranca su Matriz)
--
--  Hermano de dbo.UsuarioEtapa, pero por el otro eje. Las tres etapas viejas
--  (OBRA GRIS / ACABADOS / ELECTROMECANICO) son FASES de una misma casa, y ahí
--  la etapa sirve de filtro. Infraestructura y Postventa, en cambio, existen en
--  BC como OBRAS/centros de costo (INF-*, PV-*): a Ana y a Marco su trabajo no
--  lo distingue una fase, lo distingue la obra.
--
--  `patron` acepta las dos formas:
--     'INF-%'      -> todas las obras de infraestructura (las nuevas entran solas)
--     'INF-HDAII'  -> una obra puntual
--  Se resuelve con LIKE contra dbo.Obra.numeroObra.
--
--  Base: la del PADRÓN (hoy AdelantePRO; ver la memoria del proyecto).
-- ============================================================================

IF OBJECT_ID('dbo.UsuarioObra', 'U') IS NULL
BEGIN
  CREATE TABLE dbo.UsuarioObra (
    idUsuario INT NOT NULL,
    patron    NVARCHAR(50) NOT NULL,
    CONSTRAINT PK_UsuarioObra PRIMARY KEY (idUsuario, patron),
    CONSTRAINT FK_UsuarioObra_Usuario FOREIGN KEY (idUsuario) REFERENCES dbo.Usuario(idUsuario)
  );
  -- Sin FK a dbo.Obra a propósito: un patrón ('INF-%') no es una obra.
END
GO

-- ---------------------------------------------------------------------------
--  Cómo asignar (ajustá los usuarios):
--
--    SELECT idUsuario, username FROM dbo.Usuario;              -- ids de usuarios
--    SELECT numeroObra, nombreMostrado FROM dbo.Obra ORDER BY numeroObra;
--
--    -- Ana cubre TODA infraestructura; Marco, toda postventa:
--    INSERT dbo.UsuarioObra (idUsuario, patron)
--    SELECT idUsuario, 'INF-%' FROM dbo.Usuario WHERE username = 'anabg';
--    INSERT dbo.UsuarioObra (idUsuario, patron)
--    SELECT idUsuario, 'PV-%'  FROM dbo.Usuario WHERE username = 'marcoab';
--
--  Para quitar:
--    DELETE FROM dbo.UsuarioObra WHERE idUsuario = <id> AND patron = '<patron>';
-- ---------------------------------------------------------------------------
