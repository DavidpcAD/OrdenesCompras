-- ============================================================================
-- Notas de crédito (Bodega · Compras Adelante)
-- Líneas de una factura recibida que vienen MAL (dañado / menos cantidad /
-- precio distinto). El material se recibe igual, pero estas líneas se marcan
-- para emitir una NOTA DE CRÉDITO al proveedor. Es DISTINTO de Devoluciones.
--
-- Ejecutar una sola vez en la base de la app (AdelanteSBX / Sandbox).
-- Convenciones iguales al resto: esEliminada / fechaCreacion / creadoPor.
-- ============================================================================
IF NOT EXISTS (SELECT 1 FROM sys.tables WHERE name = 'NotaCreditoDet' AND schema_id = SCHEMA_ID('dbo'))
BEGIN
  CREATE TABLE dbo.NotaCreditoDet (
    idNotaCreditoDet  INT IDENTITY(1,1) PRIMARY KEY,
    idOrdenCompra     INT            NOT NULL,   -- FK lógica a dbo.OrdenCompra
    idOrdenCompraDet  INT            NULL,       -- línea de la orden (si aplica)
    articuloNo        NVARCHAR(40)   NULL,
    descripcion       NVARCHAR(200)  NULL,
    motivo            NVARCHAR(30)   NOT NULL,   -- danado | menos_cantidad | precio_distinto
    cantidad          DECIMAL(18,4)  NOT NULL,
    precioUnitario    DECIMAL(18,4)  NULL,
    nota              NVARCHAR(300)  NULL,
    estado            NVARCHAR(20)   NOT NULL CONSTRAINT DF_NotaCreditoDet_estado DEFAULT ('pendiente'), -- pendiente | resuelta
    esEliminada       BIT            NOT NULL CONSTRAINT DF_NotaCreditoDet_elim   DEFAULT (0),
    fechaCreacion     DATETIME       NOT NULL CONSTRAINT DF_NotaCreditoDet_fc     DEFAULT (getdate()),
    creadoPor         NVARCHAR(100)  NULL
  );
  CREATE INDEX IX_NotaCreditoDet_orden ON dbo.NotaCreditoDet(idOrdenCompra);
END;
