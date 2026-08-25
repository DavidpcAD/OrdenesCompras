-- ============================================================================
-- Foto de la factura recibida (Bodega · Compras Adelante)
--
-- Pedro recibe el material y le saca una foto a la factura física con el
-- celular. La imagen se comprime EN EL NAVEGADOR (lado largo ≤ 1600 px, JPEG)
-- antes de subirla, así que lo que entra acá pesa ~100–400 KB, no los 4 MB que
-- suelta la cámara. Después se ve desde "Recibidas" junto con las líneas.
--
-- Va en tabla APARTE (no como columna de RecepcionCompra) a propósito: el
-- bootstrap hace SELECT * de RecepcionCompra en cada refresco y arrastraría
-- todas las imágenes. Acá solo se leen los metadatos (id/mime/tamaño) y la
-- imagen se pide por su propia ruta: /api/recepciones/{id}/foto?foto={idFoto}.
--
-- Ejecutar una sola vez en la base de la app (AdelantePRO).
-- Convenciones iguales al resto: esEliminada / fechaCreacion / creadoPor.
-- La app aguanta que esta tabla NO exista: la recepción se registra igual y
-- avisa que la foto no se pudo guardar.
-- ============================================================================
IF NOT EXISTS (SELECT 1 FROM sys.tables WHERE name = 'RecepcionCompraFoto' AND schema_id = SCHEMA_ID('dbo'))
BEGIN
  CREATE TABLE dbo.RecepcionCompraFoto (
    idRecepcionCompraFoto INT IDENTITY(1,1) PRIMARY KEY,
    idRecepcionCompra     INT             NOT NULL,   -- FK lógica a dbo.RecepcionCompra
    mime                  NVARCHAR(40)    NOT NULL,   -- image/jpeg | image/webp | image/png
    imagen                VARBINARY(MAX)  NOT NULL,   -- bytes ya comprimidos
    tamano                INT             NOT NULL,   -- bytes (para no tener que leer el blob)
    ancho                 INT             NULL,
    alto                  INT             NULL,
    esEliminada           BIT             NOT NULL CONSTRAINT DF_RecepcionCompraFoto_elim DEFAULT (0),
    fechaCreacion         DATETIME        NOT NULL CONSTRAINT DF_RecepcionCompraFoto_fc   DEFAULT (getdate()),
    creadoPor             NVARCHAR(100)   NULL
  );
  CREATE INDEX IX_RecepcionCompraFoto_rec ON dbo.RecepcionCompraFoto(idRecepcionCompra);
END;
