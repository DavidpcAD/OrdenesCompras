-- Plantillas de solicitud de material para "Compras Adelante".
-- Compartidas entre usuarios; el front filtra por creadoPor.
-- Las líneas se guardan como JSON: [{ "code": "M01-0147", "cantidad": 3, "obraCodigo": "VN-M.28" }, ...]
-- Ejecutar una sola vez en la base (AdelanteSBX en dev).

IF OBJECT_ID('dbo.PlantillaSolicitud', 'U') IS NULL
BEGIN
    CREATE TABLE dbo.PlantillaSolicitud (
        idPlantillaSolicitud INT IDENTITY(1,1) NOT NULL
            CONSTRAINT PK_PlantillaSolicitud PRIMARY KEY,
        nombre              NVARCHAR(100)  NOT NULL,
        creadoPor           NVARCHAR(100)  NOT NULL,
        lineasJson          NVARCHAR(MAX)  NOT NULL,
        esEliminada         BIT            NOT NULL CONSTRAINT DF_PlantillaSolicitud_esEliminada DEFAULT (0),
        fechaCreacion       DATETIME2(3)   NOT NULL CONSTRAINT DF_PlantillaSolicitud_fechaCreacion DEFAULT (SYSUTCDATETIME()),
        fechaModificacion   DATETIME2(3)   NULL,
        modificadoPor       NVARCHAR(100)  NULL
    );

    -- Un mismo usuario no repite nombre de plantilla (entre las no eliminadas).
    CREATE UNIQUE INDEX UX_PlantillaSolicitud_nombre_creadoPor
        ON dbo.PlantillaSolicitud (nombre, creadoPor)
        WHERE esEliminada = 0;
END;
GO
