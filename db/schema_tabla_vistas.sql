/* ============================================================================
   Compras Adelante — VISTAS DE TABLA guardadas por usuario (TanStack DataTable)
   Cada usuario puede guardar combinaciones (columnas visibles + orden + sort +
   filtros) con nombre, por cada tabla (tablaKey: 'ordenes', 'solicitudes', …).
   Idempotente.
   ============================================================================ */
IF OBJECT_ID('dbo.TablaVista','U') IS NULL
BEGIN
    CREATE TABLE dbo.TablaVista (
        id                INT IDENTITY(1,1) NOT NULL CONSTRAINT pk_TablaVista PRIMARY KEY,
        usuario           NVARCHAR(100) NOT NULL,          -- creadoPor (username)
        tablaKey          NVARCHAR(60)  NOT NULL,          -- 'ordenes', 'solicitudes', …
        nombre            NVARCHAR(100) NOT NULL,          -- nombre de la vista
        configJson        NVARCHAR(MAX) NOT NULL,          -- { columnOrder, columnVisibility, sorting, columnFilters, globalFilter, pageSize }
        esPredeterminada  BIT NOT NULL CONSTRAINT df_TablaVista_pred DEFAULT(0),
        esEliminada       BIT NOT NULL CONSTRAINT df_TablaVista_del  DEFAULT(0),
        fechaCreacion     DATETIME2(0) NOT NULL CONSTRAINT df_TablaVista_fc DEFAULT(SYSUTCDATETIME()),
        fechaModificacion DATETIME2(0) NULL,
        CONSTRAINT uq_TablaVista UNIQUE (usuario, tablaKey, nombre)
    );
    CREATE INDEX ix_TablaVista_usuario_tabla ON dbo.TablaVista(usuario, tablaKey);
END
GO
