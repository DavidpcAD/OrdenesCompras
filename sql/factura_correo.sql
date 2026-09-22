-- ============================================================================
-- Comprobantes que llegan al buzón de facturación (Vigilancia · Compras Adelante)
--
-- Para qué existe: al buzón facturacion@adelantedesarrollos.com entran ~1.300
-- correos al mes y a Business Central se registran ~1.000 facturas, y hasta el 22
-- de setiembre de 2026 no había forma de ver cuál de las dos cifras le faltaba a la
-- otra. Una revisión del año encontró 31 facturas en borrador que nunca se
-- registraron (₡7,5 millones) y 13 pares con pinta de doble registro.
--
-- Por qué hace falta una tabla y no basta con mirar el correo y BC en vivo:
--
--   1. El buzón NO tiene ninguna marca de "esta ya la registré". Las carpetas
--      FACTURAS DESCARGADAS y XML temporal están vacías, y la bandeja lleva 8.741
--      correos sin leer de 31.932. Sin memoria propia no se puede decir "esta lleva
--      nueve días sin registrarse" ni que alguien la cierre.
--   2. BC no sabe qué llegó por correo. Sabe lo que se digitó, nada más.
--   3. Leer 15.000 correos en cada refresco de pantalla no es viable.
--
-- La llave primaria es la CLAVE de Hacienda: 50 dígitos, única por ley. Así el
-- mismo comprobante no entra dos veces aunque el proveedor reenvíe el correo tres
-- veces, que pasa seguido.
--
-- Ejecutar una sola vez en la base de la app (AdelantePRO).
-- La app aguanta que esta tabla NO exista: la pantalla avisa que falta correrla y
-- el resto de la vigilancia (las señales que salen de BC solo) sigue funcionando.
-- ============================================================================
IF NOT EXISTS (SELECT 1 FROM sys.tables WHERE name = 'FacturaCorreo' AND schema_id = SCHEMA_ID('dbo'))
BEGIN
  CREATE TABLE dbo.FacturaCorreo (
    clave            CHAR(50)        NOT NULL PRIMARY KEY,   -- la de Hacienda, única por ley
    consecutivo      CHAR(20)        NOT NULL,
    tipoDoc          CHAR(2)         NOT NULL,   -- 01 factura · 02 ND · 03 NC · 04 tiquete · 08 FEC
    cedulaEmisor     VARCHAR(12)     NOT NULL,
    nombreEmisor     NVARCHAR(200)   NULL,
    cedulaReceptor   VARCHAR(12)     NULL,       -- para apartar lo de las empresas hermanas
    fechaEmision     DATE            NULL,
    moneda           VARCHAR(10)     NOT NULL CONSTRAINT DF_FacturaCorreo_mon DEFAULT ('CRC'),
    total            DECIMAL(19,4)   NOT NULL CONSTRAINT DF_FacturaCorreo_tot DEFAULT (0),

    -- De dónde salió, para poder volver al correo desde la pantalla.
    fechaCorreo      DATETIME        NULL,
    messageId        NVARCHAR(400)   NULL,
    webLink          NVARCHAR(1000)  NULL,
    remitente        NVARCHAR(200)   NULL,

    -- Lo que encontró el cotejo contra BC. `bcNumero` se llena cuando aparece la
    -- factura registrada, y `fechaRegistro` guarda CUÁNDO la vimos registrada —
    -- que no es lo mismo que la fecha del documento en BC, y es lo que contesta
    -- "¿cuánto tardó en digitarse?".
    estado           VARCHAR(20)     NOT NULL CONSTRAINT DF_FacturaCorreo_est DEFAULT ('pendiente'),
                                     -- pendiente | registrada | descuadrada | no_aplica | otra_empresa
    bcNumero         VARCHAR(40)     NULL,       -- CFR-010077
    bcProveedor      VARCHAR(40)     NULL,       -- PROV-001717
    bcTotal          DECIMAL(19,4)   NULL,
    bcCalzePor       VARCHAR(10)     NULL,       -- cedula | nombre
    fechaRegistro    DATETIME        NULL,       -- cuándo se detectó registrada
    ultimoCotejo     DATETIME        NULL,       -- cuándo se revisó por última vez

    -- Cuando alguien la cierra a mano ("no aplica", "es de otra empresa").
    revisadoPor      NVARCHAR(100)   NULL,
    revisadoEn       DATETIME        NULL,
    nota             NVARCHAR(500)   NULL,

    fechaCreacion    DATETIME        NOT NULL CONSTRAINT DF_FacturaCorreo_fc DEFAULT (getdate())
  );

  -- La pantalla pregunta casi siempre "qué está pendiente, lo más viejo primero".
  CREATE INDEX IX_FacturaCorreo_estado ON dbo.FacturaCorreo (estado, fechaEmision);
  -- Y el cotejo busca por emisor + consecutivo.
  CREATE INDEX IX_FacturaCorreo_emisor ON dbo.FacturaCorreo (cedulaEmisor, consecutivo);
END
GO

-- ----------------------------------------------------------------------------
-- Marcador de hasta dónde leyó el buzón, para no releerlo entero cada vez.
--
-- Es la fecha del correo más nuevo que ya se procesó. Se relee con unos minutos de
-- traslape a propósito: un correo que entra mientras corre la sincronización se
-- perdería si el marcador avanzara al filo. Releer de más no cuesta nada porque la
-- clave de Hacienda es la llave primaria y el repetido simplemente no entra.
-- ----------------------------------------------------------------------------
IF NOT EXISTS (SELECT 1 FROM sys.tables WHERE name = 'FacturaCorreoSync' AND schema_id = SCHEMA_ID('dbo'))
BEGIN
  CREATE TABLE dbo.FacturaCorreoSync (
    id            TINYINT         NOT NULL PRIMARY KEY CONSTRAINT DF_FacturaCorreoSync_id DEFAULT (1),
    marcador      NVARCHAR(40)    NULL,   -- fecha ISO del correo más nuevo ya procesado
    ultimaCorrida DATETIME        NULL,
    ultimoError   NVARCHAR(500)   NULL,
    leidos        INT             NULL,   -- correos mirados en la última corrida
    nuevos        INT             NULL,   -- comprobantes nuevos guardados
    CONSTRAINT CK_FacturaCorreoSync_una_fila CHECK (id = 1)
  );
  INSERT INTO dbo.FacturaCorreoSync (id) VALUES (1);
END
GO
