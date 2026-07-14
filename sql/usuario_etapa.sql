-- ============================================================================
--  Mapeo INGENIERO -> ETAPA(s)  (especialidad: acabados / obra gris / electromec.)
--  Muchos-a-muchos: un ingeniero puede cubrir varias etapas.
--  Se usa en la Matriz: al entrar, cada ingeniero ve por defecto las
--  clasificaciones de SU etapa.  Base: AdelanteSBX.
-- ============================================================================

IF OBJECT_ID('dbo.UsuarioEtapa', 'U') IS NULL
BEGIN
  CREATE TABLE dbo.UsuarioEtapa (
    idUsuario INT NOT NULL,
    idEtapa   INT NOT NULL,
    CONSTRAINT PK_UsuarioEtapa PRIMARY KEY (idUsuario, idEtapa),
    CONSTRAINT FK_UsuarioEtapa_Usuario FOREIGN KEY (idUsuario) REFERENCES dbo.Usuario(idUsuario),
    CONSTRAINT FK_UsuarioEtapa_Etapa   FOREIGN KEY (idEtapa)   REFERENCES dbo.etapa(id)
  );
END
GO

-- ---------------------------------------------------------------------------
--  Cómo asignar especialidades (ajustá los valores a tus ingenieros):
--
--    SELECT idUsuario, username FROM dbo.Usuario;      -- ver ids de usuarios
--    SELECT id, codigo, nombre  FROM dbo.etapa;        -- ver etapas (acabados, etc.)
--
--    -- Ej.: Laura hace ACABADOS (idEtapa 2)
--    INSERT dbo.UsuarioEtapa (idUsuario, idEtapa) VALUES (<idUsuario>, 2);
--    -- Un ingeniero con 2 especialidades: dos filas.
--
--  Para quitar: DELETE FROM dbo.UsuarioEtapa WHERE idUsuario = <id> AND idEtapa = <id>;
-- ---------------------------------------------------------------------------
