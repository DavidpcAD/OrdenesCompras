-- ============================================================================
-- Historial de Cargo sobre factura (Contabilidad · Compras Adelante)
-- Cada cargo de un tercero (flete, traspaso de lotes…) que se registra en BC desde
-- /facturacion/cargo. BC solo sabe que lo registró la app (User_ID
-- BUSINESSCENTRAL_API_ADELANTE); acá queda quién fue, cuándo, contra qué líneas de
-- recepción se asignó y si había un borrador de la misma factura en BC.
--
-- La app crea estas tablas sola la primera vez que las usa (ensureCargosRecibidosTables
-- en lib/repo.ts); este script es el mismo DDL para correrlo a mano. Idempotente.
-- Base: AdelantePRO. Convenciones iguales al resto: esEliminada / fechaCreacion / creadoPor.
-- OJO: la columna es `lineaNo`, no `lineNo` (LINENO es palabra reservada de T-SQL).
-- ============================================================================
IF NOT EXISTS (SELECT 1 FROM sys.tables WHERE name = 'CargoRecibido' AND schema_id = SCHEMA_ID('dbo'))
BEGIN
  CREATE TABLE dbo.CargoRecibido (
    idCargoRecibido   INT IDENTITY(1,1) PRIMARY KEY,
    facturaBc         NVARCHAR(30)   NULL,      -- CFR-… que devolvió BC al registrar
    proveedorNo       NVARCHAR(30)   NOT NULL,  -- proveedor del CARGO (transportista)
    proveedorNombre   NVARCHAR(150)  NULL,
    facturaProveedor  NVARCHAR(50)   NOT NULL,  -- N.º de la factura del proveedor
    fechaFactura      DATE           NULL,      -- la que se mandó como fecha de registro
    moneda            NVARCHAR(10)   NULL,      -- del cargo; '' = colones
    tipoCargo         NVARCHAR(30)   NULL,      -- Item Charge de BC (p. ej. 05)
    descripcionCargo  NVARCHAR(150)  NULL,
    cantidad          DECIMAL(18,4)  NOT NULL,
    precioUnitario    DECIMAL(18,4)  NOT NULL,
    importe           DECIMAL(18,4)  NOT NULL,
    metodo            NVARCHAR(20)   NULL,      -- Amount | Equally | Weight | Volume
    borradoresBc      NVARCHAR(300)  NULL,      -- CF-… de la misma factura que había en BC (separados por coma)
    esEliminada       BIT            NOT NULL CONSTRAINT DF_CargoRecibido_elim DEFAULT (0),
    fechaCreacion     DATETIME       NOT NULL CONSTRAINT DF_CargoRecibido_fc   DEFAULT (getdate()),
    creadoPor         NVARCHAR(100)  NULL,
    rol               NVARCHAR(20)   NULL
  );
END;

IF NOT EXISTS (SELECT 1 FROM sys.tables WHERE name = 'CargoRecibidoDet' AND schema_id = SCHEMA_ID('dbo'))
BEGIN
  CREATE TABLE dbo.CargoRecibidoDet (
    idCargoRecibidoDet INT IDENTITY(1,1) PRIMARY KEY,
    idCargoRecibido    INT            NOT NULL,  -- FK lógica a dbo.CargoRecibido
    recepcionNo        NVARCHAR(30)   NOT NULL,  -- CR-…
    lineaNo            INT            NOT NULL,  -- Line No. de la recepción en BC
    articuloNo         NVARCHAR(40)   NULL,
    descripcion        NVARCHAR(200)  NULL,
    almacen            NVARCHAR(20)   NULL,
    cantidad           DECIMAL(18,4)  NULL,
    importeLinea       DECIMAL(18,4)  NULL,      -- en la moneda de la LÍNEA, no la del cargo
    monedaLinea        NVARCHAR(10)   NULL,
    asignadoEstimado   DECIMAL(18,4)  NULL       -- reparto que calculó la app; NULL = peso/volumen (lo calcula BC)
  );
  CREATE INDEX IX_CargoRecibidoDet_cargo ON dbo.CargoRecibidoDet(idCargoRecibido);
END;
