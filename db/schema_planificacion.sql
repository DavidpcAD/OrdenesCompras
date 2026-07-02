/* ============================================================================
   Compras Adelante — PLANIFICACIÓN (reemplaza las hojas del Excel "Avance Semanal")
   Misma convención de la casa (PascalCase, idTabla IDENTITY, FK, soft-delete + audit).

   Idea clave: el Excel usa UNA HOJA por proyecto/vista porque es plano.
   En SQL se normaliza y cada "hoja" es una CONSULTA (filtro), no una tabla:
     - Hoja "Programacion"            = Unidad × PlanCelda × Partida (pivot al mostrar)
     - Hoja "Casa Marcos" / proyecto  = Requerimiento WHERE idProyecto = X
     - Hoja "Pedido N - Puertas"      = PedidoCompra WHERE idPartida  = 'Puertas'
     - Hoja "Muebles"                 = Requerimiento WHERE idPartida = 'Muebles'

   Nivel de detalle:
     Proyecto 1---N Unidad 1---N PlanCelda (matriz de avance por partida)
                     Unidad 1---N Requerimiento (materiales+cantidad por partida → BC)
     Requerimiento --alimenta--> PedidoCompraDet al "Armar pedido"
   ============================================================================ */

/* ---- Proyecto: cada "hoja"/obra del Excel (Gran Vía, Clínica Universal, …) ---- */
IF OBJECT_ID('dbo.Proyecto','U') IS NULL
BEGIN
    CREATE TABLE [dbo].[Proyecto](
        [idProyecto]       [int] IDENTITY(1,1) NOT NULL,
        [nombre]           [nvarchar](120) NOT NULL,
        [jobNo]            [nvarchar](20)  NULL,      -- espejo BC: No. del proyecto/Job
        [esEliminada]      [bit] NOT NULL CONSTRAINT [df_Proyecto_esEliminada] DEFAULT(0),
        [fechaCreacion]    [datetime2](0) NOT NULL CONSTRAINT [df_Proyecto_fc] DEFAULT(SYSUTCDATETIME()),
        [creadoPor]        [nvarchar](80) NULL,
        [fechaModificacion][datetime2](0) NULL,
        [modificadoPor]    [nvarchar](80) NULL,
        CONSTRAINT [pk_Proyecto] PRIMARY KEY CLUSTERED ([idProyecto] ASC)
    ) ON [PRIMARY];
END
GO

/* ---- Partida: catálogo de rubros/categorías (columnas de "Programacion").
        Global; el ingeniero puede crear. Ej: MONOCOMANDO, LIVIANO, muebles,
        color (muebles), puertas, granito, cerámica, … ---------------------------- */
IF OBJECT_ID('dbo.Partida','U') IS NULL
BEGIN
    CREATE TABLE [dbo].[Partida](
        [idPartida]        [int] IDENTITY(1,1) NOT NULL,
        [nombre]           [nvarchar](80) NOT NULL,
        [orden]            [int] NULL,                -- para el orden de columnas
        [esEliminada]      [bit] NOT NULL CONSTRAINT [df_Partida_esEliminada] DEFAULT(0),
        [fechaCreacion]    [datetime2](0) NOT NULL CONSTRAINT [df_Partida_fc] DEFAULT(SYSUTCDATETIME()),
        [creadoPor]        [nvarchar](80) NULL,
        CONSTRAINT [pk_Partida] PRIMARY KEY CLUSTERED ([idPartida] ASC)
    ) ON [PRIMARY];
END
GO

/* ---- Unidad: cada casa/lote de un proyecto (filas de "Programacion") ---------- */
IF OBJECT_ID('dbo.Unidad','U') IS NULL
BEGIN
    CREATE TABLE [dbo].[Unidad](
        [idUnidad]         [int] IDENTITY(1,1) NOT NULL,
        [idProyecto]       [int] NOT NULL,
        [modelo]           [nvarchar](120) NULL,      -- "Zante DA / Azotea"
        [lote]             [nvarchar](30)  NULL,      -- "H04" (casa)
        [responsable]      [nvarchar](80)  NULL,
        [esEliminada]      [bit] NOT NULL CONSTRAINT [df_Unidad_esEliminada] DEFAULT(0),
        [fechaCreacion]    [datetime2](0) NOT NULL CONSTRAINT [df_Unidad_fc] DEFAULT(SYSUTCDATETIME()),
        [creadoPor]        [nvarchar](80) NULL,
        [fechaModificacion][datetime2](0) NULL,
        [modificadoPor]    [nvarchar](80) NULL,
        CONSTRAINT [pk_Unidad] PRIMARY KEY CLUSTERED ([idUnidad] ASC),
        CONSTRAINT [fk_Unidad_Proyecto] FOREIGN KEY ([idProyecto]) REFERENCES [dbo].[Proyecto]([idProyecto])
    ) ON [PRIMARY];
    CREATE INDEX [ix_Unidad_Proyecto] ON [dbo].[Unidad]([idProyecto]);
END
GO

/* ---- PlanCelda: la MATRIZ de avance (una fila por celda unidad×partida).
        Aquí vive lo que en el Excel es la fecha / color / estado (P, n/a). ------- */
IF OBJECT_ID('dbo.PlanCelda','U') IS NULL
BEGIN
    CREATE TABLE [dbo].[PlanCelda](
        [idPlanCelda]      [int] IDENTITY(1,1) NOT NULL,
        [idUnidad]         [int] NOT NULL,
        [idPartida]        [int] NOT NULL,
        [valor]            [nvarchar](120) NULL,      -- texto libre: color, "P", "n/a"
        [fechaPlan]        [date] NULL,               -- si la celda es una fecha
        [estado]           [nvarchar](20) NULL,       -- opcional: pendiente/listo/na
        [fechaModificacion][datetime2](0) NULL,
        [modificadoPor]    [nvarchar](80) NULL,
        CONSTRAINT [pk_PlanCelda] PRIMARY KEY CLUSTERED ([idPlanCelda] ASC),
        CONSTRAINT [fk_PlanCelda_Unidad]  FOREIGN KEY ([idUnidad])  REFERENCES [dbo].[Unidad]([idUnidad]),
        CONSTRAINT [fk_PlanCelda_Partida] FOREIGN KEY ([idPartida]) REFERENCES [dbo].[Partida]([idPartida]),
        CONSTRAINT [uq_PlanCelda] UNIQUE ([idUnidad],[idPartida])   -- una celda por cruce
    ) ON [PRIMARY];
END
GO

/* ---- Requerimiento: take-off de materiales por unidad+partida
        (las hojas "Casa Marcos", "Muebles", "Pedido N - Puertas": mampara, marco,
        Melamina, etc. con su cantidad). Es lo que alimenta el pedido de compra. --- */
IF OBJECT_ID('dbo.Requerimiento','U') IS NULL
BEGIN
    CREATE TABLE [dbo].[Requerimiento](
        [idRequerimiento]  [int] IDENTITY(1,1) NOT NULL,
        [idUnidad]         [int] NOT NULL,
        [idPartida]        [int] NULL,
        [itemNo]           [nvarchar](20) NULL,       -- espejo BC (No. del artículo)
        [descripcion]      [nvarchar](150) NULL,
        [unitOfMeasureCode][nvarchar](10) NULL,
        [cantidad]         [decimal](18,4) NOT NULL CONSTRAINT [df_Req_cant] DEFAULT(0),
        [cantidadPedida]   [decimal](18,4) NOT NULL CONSTRAINT [df_Req_ped] DEFAULT(0), -- cuánto ya pasó a pedido
        [esEliminada]      [bit] NOT NULL CONSTRAINT [df_Req_esEliminada] DEFAULT(0),
        [fechaCreacion]    [datetime2](0) NOT NULL CONSTRAINT [df_Req_fc] DEFAULT(SYSUTCDATETIME()),
        [creadoPor]        [nvarchar](80) NULL,
        CONSTRAINT [pk_Requerimiento] PRIMARY KEY CLUSTERED ([idRequerimiento] ASC),
        CONSTRAINT [fk_Req_Unidad]  FOREIGN KEY ([idUnidad])  REFERENCES [dbo].[Unidad]([idUnidad]),
        CONSTRAINT [fk_Req_Partida] FOREIGN KEY ([idPartida]) REFERENCES [dbo].[Partida]([idPartida])
    ) ON [PRIMARY];
    CREATE INDEX [ix_Req_Unidad] ON [dbo].[Requerimiento]([idUnidad]);
END
GO

/* ---- Enlace Pedido <-> Unidad/Partida: reemplaza el "loteRef" por FKs reales.
        Así "qué se pidió por unidad" y "Pedido N - Puertas" son un simple WHERE. --- */
IF COL_LENGTH('dbo.PedidoCompra','idUnidad') IS NULL
    ALTER TABLE [dbo].[PedidoCompra] ADD [idUnidad] [int] NULL
        CONSTRAINT [fk_PedidoCompra_Unidad] FOREIGN KEY ([idUnidad]) REFERENCES [dbo].[Unidad]([idUnidad]);
GO
IF COL_LENGTH('dbo.PedidoCompra','idPartida') IS NULL
    ALTER TABLE [dbo].[PedidoCompra] ADD [idPartida] [int] NULL
        CONSTRAINT [fk_PedidoCompra_Partida] FOREIGN KEY ([idPartida]) REFERENCES [dbo].[Partida]([idPartida]);
GO
