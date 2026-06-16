/* ============================================================================
   Compras Adelante — Pedidos / Órdenes / Recepciones de compra
   Estructura siguiendo la MISMA convención que las Boletas
   (BoletaSalida / BoletaEntrega / BoletaTraslado y sus *Det).

   Convención de la casa:
     - Cabecera PascalCase + detalle con sufijo  Det
     - PK  id<Tabla>  int IDENTITY(1,1)   (pk_<Tabla>)
     - idEstado  FK -> dbo.Estado
     - Encadenamiento por FK:  OrdenCompra.idPedidoCompra -> PedidoCompra
                               RecepcionCompra.idOrdenCompra -> OrdenCompra
       (igual que BoletaEntrega.idBoletaSalida, BoletaTraslado.idBoletaEntrega)
     - Soft delete  esEliminada  +  auditoría
       fechaCreacion / creadoPor / fechaModificacion / modificadoPor
     - Flujo de aprobación  esAprobado / fechaAprobado / aprobadoPor / notaAprobador
     - Campos espejo de Business Central en el detalle
       (itemNo, variantCode, unitOfMeasureCode, locationCode,
        shortcutDimension1/2Code, taskNo, entryNoALM/MOV, postingDate, documentNo)

   Flujo:  PedidoCompra (ingeniería ~ Oferta CCT)
             -> OrdenCompra (proveeduría ~ Pedido CP)
               -> RecepcionCompra (facturación ~ recepción/factura)
   ============================================================================ */

/* ---------------------------------------------------------------------------
   Catálogo de estados (compartido, como en Boletas). Se crea si no existe
   y se siembran los estados del flujo de compras.
   --------------------------------------------------------------------------- */
IF OBJECT_ID('dbo.Estado','U') IS NULL
BEGIN
    CREATE TABLE [dbo].[Estado](
        [idEstado] [int] IDENTITY(1,1) NOT NULL,
        [nombre]   [nvarchar](50) NOT NULL,
        [modulo]   [nvarchar](30) NULL,
        CONSTRAINT [pk_Estado] PRIMARY KEY CLUSTERED ([idEstado] ASC)
    ) ON [PRIMARY];
END
GO
-- Estados del flujo de compras (idempotente)
MERGE [dbo].[Estado] AS t
USING (VALUES
    ('Borrador','Compras'),
    ('Pendiente de aprobación','Compras'),
    ('Aprobado','Compras'),
    ('Lanzado','Compras'),
    ('Parcial','Compras'),
    ('Completado','Compras'),
    ('Anulado','Compras')
) AS s(nombre,modulo) ON t.nombre = s.nombre AND t.modulo = s.modulo
WHEN NOT MATCHED THEN INSERT (nombre,modulo) VALUES (s.nombre,s.modulo);
GO

/* ===========================================================================
   1) PEDIDO DE COMPRA  (Ingeniería · solicitud de material ~ BC Oferta / CCT)
   =========================================================================== */
SET ANSI_NULLS ON
GO
SET QUOTED_IDENTIFIER ON
GO
CREATE TABLE [dbo].[PedidoCompra](
	[idPedidoCompra] [int] IDENTITY(1,1) NOT NULL,
	[idCaso] [int] NULL,
	[idEstado] [int] NULL,
	[pedidoNo] [nvarchar](50) NULL,
	[tipoSolicitud] [nvarchar](15) NULL,           -- 'material' (va a obra) | 'repuesto' (va a máquina)
	[obra] [nvarchar](50) NULL,                    -- destino si tipoSolicitud = material
	[maquinaNo] [nvarchar](20) NULL,               -- destino si tipoSolicitud = repuesto (GomEqp Machine No.)
	[proyecto] [nvarchar](150) NULL,
	[solicitante] [nvarchar](100) NULL,
	[prioridad] [nvarchar](20) NULL,
	[taskNo] [nvarchar](15) NULL,
	[notaCreador] [nvarchar](500) NULL,
	[notaAprobador] [nvarchar](250) NULL,
	[fechaAprobado] [datetime2](7) NULL,
	[aprobadoPor] [nvarchar](100) NULL,
	[esAprobado] [bit] NULL,
	[fechaCompletado] [datetime2](7) NULL,
	-- espejo Business Central
	[bcSystemId] [uniqueidentifier] NULL,
	[bcDocumentType] [nvarchar](20) NULL,          -- 'Oferta'
	[bcNo] [nvarchar](20) NULL,                    -- CCT-000038
	[noSeries] [nvarchar](20) NULL,                -- C COTIZA
	[bcStatus] [nvarchar](25) NULL,
	[syncedToBc] [bit] NULL,
	-- soft delete + auditoría
	[esEliminada] [bit] NULL,
	[fechaCreacion] [datetime2](7) NOT NULL,
	[creadoPor] [nvarchar](100) NOT NULL,
	[fechaModificacion] [datetime2](7) NULL,
	[modificadoPor] [nvarchar](100) NULL
) ON [PRIMARY]
GO
ALTER TABLE [dbo].[PedidoCompra] ADD  CONSTRAINT [pk_PedidoCompra] PRIMARY KEY CLUSTERED ([idPedidoCompra] ASC) ON [PRIMARY]
GO
ALTER TABLE [dbo].[PedidoCompra] ADD  CONSTRAINT [df_PedidoCompra_fechaCreacion]  DEFAULT (getdate()) FOR [fechaCreacion]
GO
ALTER TABLE [dbo].[PedidoCompra]  WITH CHECK ADD  CONSTRAINT [fk_PedidoCompra_idEstado] FOREIGN KEY([idEstado]) REFERENCES [dbo].[Estado] ([idEstado])
GO
ALTER TABLE [dbo].[PedidoCompra] CHECK CONSTRAINT [fk_PedidoCompra_idEstado]
GO

SET ANSI_NULLS ON
GO
SET QUOTED_IDENTIFIER ON
GO
CREATE TABLE [dbo].[PedidoCompraDet](
	[idPedidoCompraDet] [int] IDENTITY(1,1) NOT NULL,
	[idPedidoCompra] [int] NOT NULL,
	[idEstado] [int] NULL,
	[lineNum] [int] NULL,
	[descripcion] [nvarchar](250) NULL,
	[notaCreador] [nvarchar](255) NULL,
	[taskNo] [nvarchar](15) NULL,
	[obra] [nvarchar](50) NULL,                    -- destino por línea (material)
	[maquinaNo] [nvarchar](20) NULL,               -- destino por línea (repuesto)
	[quantitySolicitado] [decimal](18, 4) NULL,
	[quantityOrdenado] [decimal](18, 4) NULL,      -- cuánto ya pasó a una orden
	[itemNo] [nvarchar](50) NULL,
	[variantCode] [nvarchar](20) NULL,
	[unitOfMeasureCode] [nvarchar](20) NULL,
	[locationCode] [nvarchar](20) NULL,
	[shortcutDimension1Code] [nvarchar](50) NULL,
	[shortcutDimension2Code] [nvarchar](50) NULL,
	[esEditado] [bit] NULL,
	[fechaCreacion] [datetime2](7) NOT NULL,
	[creadoPor] [nvarchar](100) NOT NULL,
	[fechaModificacion] [datetime2](7) NULL,
	[modificadoPor] [nvarchar](100) NULL
) ON [PRIMARY]
GO
ALTER TABLE [dbo].[PedidoCompraDet] ADD  CONSTRAINT [pk_PedidoCompraDet] PRIMARY KEY CLUSTERED ([idPedidoCompraDet] ASC) ON [PRIMARY]
GO
ALTER TABLE [dbo].[PedidoCompraDet] ADD  CONSTRAINT [df_PedidoCompraDet_fechaCreacion]  DEFAULT (getdate()) FOR [fechaCreacion]
GO
ALTER TABLE [dbo].[PedidoCompraDet]  WITH CHECK ADD  CONSTRAINT [fk_PedidoCompraDet_idPedidoCompra] FOREIGN KEY([idPedidoCompra]) REFERENCES [dbo].[PedidoCompra] ([idPedidoCompra])
GO
ALTER TABLE [dbo].[PedidoCompraDet] CHECK CONSTRAINT [fk_PedidoCompraDet_idPedidoCompra]
GO
ALTER TABLE [dbo].[PedidoCompraDet]  WITH CHECK ADD  CONSTRAINT [fk_PedidoCompraDet_idEstado] FOREIGN KEY([idEstado]) REFERENCES [dbo].[Estado] ([idEstado])
GO
ALTER TABLE [dbo].[PedidoCompraDet] CHECK CONSTRAINT [fk_PedidoCompraDet_idEstado]
GO

/* ===========================================================================
   2) ORDEN DE COMPRA  (Proveeduría · orden al proveedor ~ BC Pedido / CP)
      Nace de un PedidoCompra (idPedidoCompra) o se crea directa (NULL),
      igual que BoletaEntrega.idBoletaSalida puede ser NULL.
   =========================================================================== */
SET ANSI_NULLS ON
GO
SET QUOTED_IDENTIFIER ON
GO
CREATE TABLE [dbo].[OrdenCompra](
	[idOrdenCompra] [int] IDENTITY(1,1) NOT NULL,
	-- NO hay FK a un solo pedido: una orden combina líneas de VARIOS pedidos.
	-- El enlace pedido<->orden es N:M y vive en OrdenCompraDet.idPedidoCompraDet.
	[idEstado] [int] NULL,
	[ordenNo] [nvarchar](50) NULL,                 -- CP-000357
	[proveedorNo] [nvarchar](20) NULL,             -- PROV-001305
	[proveedorNombre] [nvarchar](150) NULL,
	[obra] [nvarchar](50) NULL,
	[fechaEmision] [date] NULL,
	[fechaPedido] [date] NULL,
	[fechaVencimiento] [date] NULL,
	[fechaRecepEsperada] [date] NULL,
	[currencyCode] [nvarchar](10) NULL,            -- vacío = CRC
	[currencyFactor] [decimal](18, 12) NULL,       -- tipo de cambio
	[paymentTermsCode] [nvarchar](10) NULL,        -- CONTADO
	[paymentMethodCode] [nvarchar](10) NULL,       -- TRANSFER
	[vendorInvoiceNo] [nvarchar](40) NULL,
	[montoSinIva] [decimal](18, 2) NULL,
	[montoConIva] [decimal](18, 2) NULL,
	[notaCreador] [nvarchar](500) NULL,
	[notaAprobador] [nvarchar](250) NULL,
	[fechaAprobado] [datetime2](7) NULL,
	[aprobadoPor] [nvarchar](100) NULL,
	[esAprobado] [bit] NULL,
	[versionesArchivadas] [int] NULL,
	[completelyReceived] [bit] NULL,
	[partiallyInvoiced] [bit] NULL,
	[receivedNotInvoiced] [bit] NULL,
	-- espejo Business Central
	[bcSystemId] [uniqueidentifier] NULL,
	[bcDocumentType] [nvarchar](20) NULL,          -- 'Pedido'
	[bcNo] [nvarchar](20) NULL,                    -- CP-000357
	[noSeries] [nvarchar](20) NULL,                -- C PED
	[postingNoSeries] [nvarchar](20) NULL,         -- C FAC R
	[receivingNoSeries] [nvarchar](20) NULL,       -- C RECEPC
	[quoteNo] [nvarchar](20) NULL,                 -- enlace a la oferta
	[shortcutDimension1Code] [nvarchar](50) NULL,
	[shortcutDimension2Code] [nvarchar](50) NULL,
	[dimensionSetId] [int] NULL,
	[taxRegime] [nvarchar](40) NULL,               -- LLB Type Of Tax Regime
	[syncedToBc] [bit] NULL,
	-- soft delete + auditoría
	[esEliminada] [bit] NULL,
	[fechaCreacion] [datetime2](7) NOT NULL,
	[creadoPor] [nvarchar](100) NOT NULL,
	[fechaModificacion] [datetime2](7) NULL,
	[modificadoPor] [nvarchar](100) NULL
) ON [PRIMARY]
GO
ALTER TABLE [dbo].[OrdenCompra] ADD  CONSTRAINT [pk_OrdenCompra] PRIMARY KEY CLUSTERED ([idOrdenCompra] ASC) ON [PRIMARY]
GO
ALTER TABLE [dbo].[OrdenCompra] ADD  CONSTRAINT [df_OrdenCompra_fechaCreacion]  DEFAULT (getdate()) FOR [fechaCreacion]
GO
ALTER TABLE [dbo].[OrdenCompra]  WITH CHECK ADD  CONSTRAINT [fk_OrdenCompra_idEstado] FOREIGN KEY([idEstado]) REFERENCES [dbo].[Estado] ([idEstado])
GO
ALTER TABLE [dbo].[OrdenCompra] CHECK CONSTRAINT [fk_OrdenCompra_idEstado]
GO

SET ANSI_NULLS ON
GO
SET QUOTED_IDENTIFIER ON
GO
CREATE TABLE [dbo].[OrdenCompraDet](
	[idOrdenCompraDet] [int] IDENTITY(1,1) NOT NULL,
	[idOrdenCompra] [int] NOT NULL,
	[idPedidoCompraDet] [int] NULL,                -- trazabilidad a la línea de pedido
	[idEstado] [int] NULL,
	[lineNum] [int] NULL,
	[tipoLinea] [nvarchar](30) NULL,               -- articulo / cargo / comentario / cuenta / recurso / activo_fijo
	[descripcion] [nvarchar](250) NULL,
	[referenciaAnulacion] [nvarchar](100) NULL,
	[itemNo] [nvarchar](50) NULL,
	[variantCode] [nvarchar](20) NULL,
	[unitOfMeasureCode] [nvarchar](20) NULL,
	[locationCode] [nvarchar](20) NULL,
	[taskNo] [nvarchar](15) NULL,
	[quantity] [decimal](18, 4) NULL,
	[quantityRecibida] [decimal](18, 4) NULL,
	[quantityFacturada] [decimal](18, 4) NULL,
	[qtyToReceive] [decimal](18, 4) NULL,
	[qtyToInvoice] [decimal](18, 4) NULL,
	[directUnitCost] [decimal](18, 4) NULL,        -- precio unitario
	[unitCostLcy] [decimal](18, 4) NULL,           -- costo en colones
	[lineAmount] [decimal](18, 2) NULL,
	[amountLcy] [decimal](18, 2) NULL,
	[vatPct] [decimal](9, 4) NULL,
	[lineDiscountPct] [decimal](9, 4) NULL,
	[postingGroup] [nvarchar](20) NULL,            -- MATERIALES
	[genProdPostingGroup] [nvarchar](20) NULL,     -- BIENES
	[vatProdPostingGroup] [nvarchar](20) NULL,     -- EXENTO-BIENES
	[itemCategoryCode] [nvarchar](20) NULL,        -- ACCES_EQUIPOS
	[shortcutDimension1Code] [nvarchar](50) NULL,
	[shortcutDimension2Code] [nvarchar](50) NULL,
	-- cargo / flete
	[permiteAsignacionCargo] [bit] NULL,           -- Allow Item Charge Assignment
	[qtyToAssign] [decimal](18, 4) NULL,
	[qtyAssigned] [decimal](18, 4) NULL,
	-- enlaces BC
	[entryNoALM] [int] NULL,
	[entryNoMOV] [int] NULL,
	[esEditado] [bit] NULL,
	[fechaCreacion] [datetime2](7) NOT NULL,
	[creadoPor] [nvarchar](100) NOT NULL,
	[fechaModificacion] [datetime2](7) NULL,
	[modificadoPor] [nvarchar](100) NULL
) ON [PRIMARY]
GO
ALTER TABLE [dbo].[OrdenCompraDet] ADD  CONSTRAINT [pk_OrdenCompraDet] PRIMARY KEY CLUSTERED ([idOrdenCompraDet] ASC) ON [PRIMARY]
GO
ALTER TABLE [dbo].[OrdenCompraDet] ADD  CONSTRAINT [df_OrdenCompraDet_fechaCreacion]  DEFAULT (getdate()) FOR [fechaCreacion]
GO
ALTER TABLE [dbo].[OrdenCompraDet]  WITH CHECK ADD  CONSTRAINT [fk_OrdenCompraDet_idOrdenCompra] FOREIGN KEY([idOrdenCompra]) REFERENCES [dbo].[OrdenCompra] ([idOrdenCompra])
GO
ALTER TABLE [dbo].[OrdenCompraDet] CHECK CONSTRAINT [fk_OrdenCompraDet_idOrdenCompra]
GO
ALTER TABLE [dbo].[OrdenCompraDet]  WITH CHECK ADD  CONSTRAINT [fk_OrdenCompraDet_idPedidoCompraDet] FOREIGN KEY([idPedidoCompraDet]) REFERENCES [dbo].[PedidoCompraDet] ([idPedidoCompraDet])
GO
ALTER TABLE [dbo].[OrdenCompraDet] CHECK CONSTRAINT [fk_OrdenCompraDet_idPedidoCompraDet]
GO
ALTER TABLE [dbo].[OrdenCompraDet]  WITH CHECK ADD  CONSTRAINT [fk_OrdenCompraDet_idEstado] FOREIGN KEY([idEstado]) REFERENCES [dbo].[Estado] ([idEstado])
GO
ALTER TABLE [dbo].[OrdenCompraDet] CHECK CONSTRAINT [fk_OrdenCompraDet_idEstado]
GO

/* ===========================================================================
   3) RECEPCIÓN DE COMPRA  (Facturación · recepción + factura, soporta parciales)
      Cada recepción pertenece a una OrdenCompra; cada línea apunta a la
      línea de orden que recibe (idOrdenCompraDet) -> trazabilidad, igual que
      BoletaEntregaDet.idBoletaSalidaDet.
   =========================================================================== */
SET ANSI_NULLS ON
GO
SET QUOTED_IDENTIFIER ON
GO
CREATE TABLE [dbo].[RecepcionCompra](
	[idRecepcionCompra] [int] IDENTITY(1,1) NOT NULL,
	[idOrdenCompra] [int] NOT NULL,
	[idEstado] [int] NULL,
	[recepcionNo] [nvarchar](50) NULL,
	[numeroFactura] [nvarchar](40) NULL,           -- Vendor Invoice No.
	[fechaFactura] [date] NULL,
	[fechaRecepcion] [date] NULL,
	[fechaRegistro] [date] NULL,                   -- Posting Date (la que vale)
	[total] [decimal](18, 2) NULL,
	[esParcial] [bit] NULL,
	[despachadoPor] [nvarchar](100) NULL,
	[recibidoPor] [nvarchar](100) NULL,
	[notaCreador] [nvarchar](500) NULL,
	-- espejo Business Central
	[bcSystemId] [uniqueidentifier] NULL,
	[bcPurchInvoiceNo] [nvarchar](20) NULL,        -- No. de factura registrada en BC
	[postingNoSeries] [nvarchar](20) NULL,
	[syncedToBc] [bit] NULL,
	-- soft delete + auditoría
	[esEliminada] [bit] NULL,
	[fechaCreacion] [datetime2](7) NOT NULL,
	[creadoPor] [nvarchar](100) NOT NULL,
	[fechaModificacion] [datetime2](7) NULL,
	[modificadoPor] [nvarchar](100) NULL
) ON [PRIMARY]
GO
ALTER TABLE [dbo].[RecepcionCompra] ADD  CONSTRAINT [pk_RecepcionCompra] PRIMARY KEY CLUSTERED ([idRecepcionCompra] ASC) ON [PRIMARY]
GO
ALTER TABLE [dbo].[RecepcionCompra] ADD  CONSTRAINT [df_RecepcionCompra_fechaCreacion]  DEFAULT (getdate()) FOR [fechaCreacion]
GO
ALTER TABLE [dbo].[RecepcionCompra]  WITH CHECK ADD  CONSTRAINT [fk_RecepcionCompra_idOrdenCompra] FOREIGN KEY([idOrdenCompra]) REFERENCES [dbo].[OrdenCompra] ([idOrdenCompra])
GO
ALTER TABLE [dbo].[RecepcionCompra] CHECK CONSTRAINT [fk_RecepcionCompra_idOrdenCompra]
GO
ALTER TABLE [dbo].[RecepcionCompra]  WITH CHECK ADD  CONSTRAINT [fk_RecepcionCompra_idEstado] FOREIGN KEY([idEstado]) REFERENCES [dbo].[Estado] ([idEstado])
GO
ALTER TABLE [dbo].[RecepcionCompra] CHECK CONSTRAINT [fk_RecepcionCompra_idEstado]
GO

SET ANSI_NULLS ON
GO
SET QUOTED_IDENTIFIER ON
GO
CREATE TABLE [dbo].[RecepcionCompraDet](
	[idRecepcionCompraDet] [int] IDENTITY(1,1) NOT NULL,
	[idRecepcionCompra] [int] NOT NULL,
	[idOrdenCompraDet] [int] NULL,                 -- línea de orden que se recibe
	[lineNum] [int] NULL,
	[descripcion] [nvarchar](250) NULL,
	[referenciaAnulacion] [nvarchar](100) NULL,
	[itemNo] [nvarchar](50) NULL,
	[variantCode] [nvarchar](20) NULL,
	[unitOfMeasureCode] [nvarchar](20) NULL,
	[locationCode] [nvarchar](20) NULL,
	[taskNo] [nvarchar](15) NULL,
	[quantityRecibida] [decimal](18, 4) NULL,
	[importeAsignadoFlete] [decimal](18, 2) NULL,
	[postingDate] [date] NULL,
	[documentNo] [varchar](50) NULL,
	[entryNoALM] [int] NULL,
	[entryNoMOV] [int] NULL,
	[entryNoItemLedger] [int] NULL,
	[esEditado] [bit] NULL,
	[fechaCreacion] [datetime2](7) NOT NULL,
	[creadoPor] [nvarchar](100) NOT NULL,
	[fechaModificacion] [datetime2](7) NULL,
	[modificadoPor] [nvarchar](100) NULL
) ON [PRIMARY]
GO
ALTER TABLE [dbo].[RecepcionCompraDet] ADD  CONSTRAINT [pk_RecepcionCompraDet] PRIMARY KEY CLUSTERED ([idRecepcionCompraDet] ASC) ON [PRIMARY]
GO
ALTER TABLE [dbo].[RecepcionCompraDet] ADD  CONSTRAINT [df_RecepcionCompraDet_fechaCreacion]  DEFAULT (getdate()) FOR [fechaCreacion]
GO
ALTER TABLE [dbo].[RecepcionCompraDet]  WITH CHECK ADD  CONSTRAINT [fk_RecepcionCompraDet_idRecepcionCompra] FOREIGN KEY([idRecepcionCompra]) REFERENCES [dbo].[RecepcionCompra] ([idRecepcionCompra])
GO
ALTER TABLE [dbo].[RecepcionCompraDet] CHECK CONSTRAINT [fk_RecepcionCompraDet_idRecepcionCompra]
GO
ALTER TABLE [dbo].[RecepcionCompraDet]  WITH CHECK ADD  CONSTRAINT [fk_RecepcionCompraDet_idOrdenCompraDet] FOREIGN KEY([idOrdenCompraDet]) REFERENCES [dbo].[OrdenCompraDet] ([idOrdenCompraDet])
GO
ALTER TABLE [dbo].[RecepcionCompraDet] CHECK CONSTRAINT [fk_RecepcionCompraDet_idOrdenCompraDet]
GO

/* ===========================================================================
   CATÁLOGOS ESPEJO DE BUSINESS CENTRAL
   La API trae Vendor (proveedores) e Item (materiales) para seleccionarlos.
   Se guardan localmente como caché de búsqueda (lookup), sincronizados por
   `bcSystemId`. Los documentos guardan el código (proveedorNo / itemNo) como
   texto, igual que las Boletas — estas tablas respaldan el selector.
   =========================================================================== */

SET ANSI_NULLS ON
GO
SET QUOTED_IDENTIFIER ON
GO
CREATE TABLE [dbo].[Proveedor](
	[idProveedor] [int] IDENTITY(1,1) NOT NULL,
	[no] [nvarchar](20) NOT NULL,                  -- No. (1)  PROV-000001
	[nombre] [nvarchar](100) NULL,                 -- Name (2)
	[searchName] [nvarchar](100) NULL,             -- Search Name (3)
	[nombre2] [nvarchar](50) NULL,
	[direccion] [nvarchar](100) NULL,              -- Address (5)
	[direccion2] [nvarchar](50) NULL,
	[ciudad] [nvarchar](30) NULL,                  -- City (7)
	[codigoPostal] [nvarchar](20) NULL,            -- Post Code (91)
	[provincia] [nvarchar](30) NULL,               -- County (92)
	[countryRegionCode] [nvarchar](10) NULL,       -- Country/Region Code (35)
	[telefono] [nvarchar](30) NULL,                -- Phone No. (9)
	[movil] [nvarchar](30) NULL,                   -- Mobile Phone No. (5061)
	[email] [nvarchar](80) NULL,                   -- E-Mail (102)
	[contacto] [nvarchar](100) NULL,               -- Contact (8)
	[vatRegistrationNo] [nvarchar](20) NULL,       -- VAT Registration No. (86)  cédula
	[vatRegistrationType] [nvarchar](30) NULL,     -- LLB VAT registration Type  (Cédula Jurídica)
	[personType] [nvarchar](20) NULL,              -- LLB Person Type
	[foreignVendor] [bit] NULL,                    -- LLB Foreign Vendor
	[vendorPostingGroup] [nvarchar](20) NULL,      -- Vendor Posting Group (21)  CXP PRO LOC CRC
	[genBusPostingGroup] [nvarchar](20) NULL,      -- Gen. Bus. Posting Group (88)  NACIONAL
	[vatBusPostingGroup] [nvarchar](20) NULL,      -- VAT Bus. Posting Group (110)  NACIONAL
	[paymentTermsCode] [nvarchar](10) NULL,        -- Payment Terms Code (27)  CONTADO
	[paymentMethodCode] [nvarchar](10) NULL,       -- Payment Method Code (47)  TRANSFER
	[currencyCode] [nvarchar](10) NULL,            -- Currency Code (22)
	[purchaserCode] [nvarchar](20) NULL,
	[blocked] [nvarchar](20) NULL,                 -- Blocked (39)
	[privacyBlocked] [bit] NULL,
	[noSeries] [nvarchar](20) NULL,                -- C PROV
	[bcSystemId] [uniqueidentifier] NULL,
	[syncedAt] [datetime2](7) NULL,
	[esEliminada] [bit] NULL,
	[fechaCreacion] [datetime2](7) NOT NULL,
	[creadoPor] [nvarchar](100) NOT NULL,
	[fechaModificacion] [datetime2](7) NULL,
	[modificadoPor] [nvarchar](100) NULL
) ON [PRIMARY]
GO
ALTER TABLE [dbo].[Proveedor] ADD  CONSTRAINT [pk_Proveedor] PRIMARY KEY CLUSTERED ([idProveedor] ASC) ON [PRIMARY]
GO
ALTER TABLE [dbo].[Proveedor] ADD  CONSTRAINT [df_Proveedor_fechaCreacion]  DEFAULT (getdate()) FOR [fechaCreacion]
GO
CREATE UNIQUE NONCLUSTERED INDEX [ix_Proveedor_no] ON [dbo].[Proveedor]([no] ASC)
GO

SET ANSI_NULLS ON
GO
SET QUOTED_IDENTIFIER ON
GO
CREATE TABLE [dbo].[Material](
	[idMaterial] [int] IDENTITY(1,1) NOT NULL,
	[no] [nvarchar](20) NOT NULL,                  -- No. (1)  M01-0001 / CERTIF
	[no2] [nvarchar](20) NULL,
	[descripcion] [nvarchar](100) NULL,            -- Description (3)
	[descripcion2] [nvarchar](50) NULL,
	[searchDescription] [nvarchar](100) NULL,      -- Search Description (4)
	[tipo] [nvarchar](20) NULL,                    -- Type (10)  Inventario / Servicio / No inventariable
	[baseUnitOfMeasure] [nvarchar](10) NULL,       -- Base Unit of Measure (8)  UND
	[purchUnitOfMeasure] [nvarchar](10) NULL,      -- Purch. Unit of Measure (5426)
	[salesUnitOfMeasure] [nvarchar](10) NULL,
	[inventory] [decimal](18, 4) NULL,             -- Inventory (68)  existencias
	[unitCost] [decimal](18, 4) NULL,              -- Unit Cost (22)
	[lastDirectCost] [decimal](18, 4) NULL,        -- Last Direct Cost (25)
	[unitPrice] [decimal](18, 4) NULL,             -- Unit Price (18)
	[inventoryPostingGroup] [nvarchar](20) NULL,   -- Inventory Posting Group (11)
	[genProdPostingGroup] [nvarchar](20) NULL,     -- Gen. Prod. Posting Group (91)
	[vatProdPostingGroup] [nvarchar](20) NULL,     -- VAT Prod. Posting Group (99)  IVA13%-SERV
	[itemCategoryCode] [nvarchar](20) NULL,        -- Item Category Code (5702)
	[vendorNo] [nvarchar](20) NULL,                -- Vendor No. (31)
	[vendorItemNo] [nvarchar](50) NULL,            -- Vendor Item No. (32)
	[gtin] [nvarchar](14) NULL,                    -- GTIN (1217)
	[blocked] [bit] NULL,                          -- Blocked (54)
	[purchasingBlocked] [bit] NULL,                -- Purchasing Blocked (8004)
	[bcSystemId] [uniqueidentifier] NULL,
	[syncedAt] [datetime2](7) NULL,
	[esEliminada] [bit] NULL,
	[fechaCreacion] [datetime2](7) NOT NULL,
	[creadoPor] [nvarchar](100) NOT NULL,
	[fechaModificacion] [datetime2](7) NULL,
	[modificadoPor] [nvarchar](100) NULL
) ON [PRIMARY]
GO
ALTER TABLE [dbo].[Material] ADD  CONSTRAINT [pk_Material] PRIMARY KEY CLUSTERED ([idMaterial] ASC) ON [PRIMARY]
GO
ALTER TABLE [dbo].[Material] ADD  CONSTRAINT [df_Material_fechaCreacion]  DEFAULT (getdate()) FOR [fechaCreacion]
GO
CREATE UNIQUE NONCLUSTERED INDEX [ix_Material_no] ON [dbo].[Material]([no] ASC)
GO

-- Obra (destino de las solicitudes tipo 'material') — espejo de Job/Dimensión de BC
SET ANSI_NULLS ON
GO
SET QUOTED_IDENTIFIER ON
GO
CREATE TABLE [dbo].[Obra](
	[idObra] [int] IDENTITY(1,1) NOT NULL,
	[codigo] [nvarchar](20) NOT NULL,              -- OBRA-001 / jobNo
	[nombre] [nvarchar](150) NULL,
	[taskNo] [nvarchar](15) NULL,
	[shortcutDimension1Code] [nvarchar](50) NULL,
	[activa] [bit] NULL,
	[bcSystemId] [uniqueidentifier] NULL,
	[esEliminada] [bit] NULL,
	[fechaCreacion] [datetime2](7) NOT NULL,
	[creadoPor] [nvarchar](100) NOT NULL,
	[fechaModificacion] [datetime2](7) NULL,
	[modificadoPor] [nvarchar](100) NULL
) ON [PRIMARY]
GO
ALTER TABLE [dbo].[Obra] ADD  CONSTRAINT [pk_Obra] PRIMARY KEY CLUSTERED ([idObra] ASC) ON [PRIMARY]
GO
ALTER TABLE [dbo].[Obra] ADD  CONSTRAINT [df_Obra_fechaCreacion]  DEFAULT (getdate()) FOR [fechaCreacion]
GO
CREATE UNIQUE NONCLUSTERED INDEX [ix_Obra_codigo] ON [dbo].[Obra]([codigo] ASC)
GO

-- Maquina (destino de las solicitudes tipo 'repuesto') — espejo de Parque Maquinaria (GomEqp)
SET ANSI_NULLS ON
GO
SET QUOTED_IDENTIFIER ON
GO
CREATE TABLE [dbo].[Maquina](
	[idMaquina] [int] IDENTITY(1,1) NOT NULL,
	[no] [nvarchar](20) NOT NULL,                  -- GomEqp Machine No.
	[nombre] [nvarchar](150) NULL,
	[placa] [nvarchar](20) NULL,
	[obraActual] [nvarchar](20) NULL,
	[activa] [bit] NULL,
	[bcSystemId] [uniqueidentifier] NULL,
	[esEliminada] [bit] NULL,
	[fechaCreacion] [datetime2](7) NOT NULL,
	[creadoPor] [nvarchar](100) NOT NULL,
	[fechaModificacion] [datetime2](7) NULL,
	[modificadoPor] [nvarchar](100) NULL
) ON [PRIMARY]
GO
ALTER TABLE [dbo].[Maquina] ADD  CONSTRAINT [pk_Maquina] PRIMARY KEY CLUSTERED ([idMaquina] ASC) ON [PRIMARY]
GO
ALTER TABLE [dbo].[Maquina] ADD  CONSTRAINT [df_Maquina_fechaCreacion]  DEFAULT (getdate()) FOR [fechaCreacion]
GO
CREATE UNIQUE NONCLUSTERED INDEX [ix_Maquina_no] ON [dbo].[Maquina]([no] ASC)
GO

/* ===========================================================================
   VISTAS DE SALDO — "qué se pidió completo y qué no"
   =========================================================================== */

-- Saldo por línea de PEDIDO: cuánto se ha pasado a órdenes (a través de las N órdenes)
CREATE VIEW [dbo].[vw_PedidoCompraSaldo] AS
SELECT  pd.idPedidoCompra,
        pd.idPedidoCompraDet,
        pd.itemNo,
        pd.descripcion,
        pd.quantitySolicitado,
        ISNULL(SUM(od.quantity), 0)                              AS quantityOrdenado,
        pd.quantitySolicitado - ISNULL(SUM(od.quantity), 0)      AS quantityPendiente,
        CASE WHEN ISNULL(pd.quantitySolicitado,0) = 0 THEN 0
             ELSE CAST(100.0 * ISNULL(SUM(od.quantity),0) / pd.quantitySolicitado AS DECIMAL(5,2))
        END                                                      AS pctOrdenado
FROM dbo.PedidoCompraDet pd
LEFT JOIN dbo.OrdenCompraDet od ON od.idPedidoCompraDet = pd.idPedidoCompraDet
GROUP BY pd.idPedidoCompra, pd.idPedidoCompraDet, pd.itemNo, pd.descripcion, pd.quantitySolicitado;
GO

-- Saldo por línea de ORDEN: cuánto se ha recibido (a través de las N recepciones)
CREATE VIEW [dbo].[vw_OrdenCompraSaldo] AS
SELECT  od.idOrdenCompra,
        od.idOrdenCompraDet,
        od.itemNo,
        od.descripcion,
        od.quantity,
        ISNULL(SUM(rd.quantityRecibida), 0)                      AS quantityRecibida,
        od.quantity - ISNULL(SUM(rd.quantityRecibida), 0)        AS quantityPendiente,
        CASE WHEN ISNULL(od.quantity,0) = 0 THEN 0
             ELSE CAST(100.0 * ISNULL(SUM(rd.quantityRecibida),0) / od.quantity AS DECIMAL(5,2))
        END                                                      AS pctRecibido
FROM dbo.OrdenCompraDet od
LEFT JOIN dbo.RecepcionCompraDet rd ON rd.idOrdenCompraDet = od.idOrdenCompraDet
WHERE od.tipoLinea = 'articulo'
GROUP BY od.idOrdenCompra, od.idOrdenCompraDet, od.itemNo, od.descripcion, od.quantity;
GO
