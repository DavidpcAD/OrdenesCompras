/* ============================================================================
   Compras Adelante — Pedidos / Órdenes / Recepciones de compra
   Estructura siguiendo la MISMA convención que las Boletas
   (BoletaSalida / BoletaEntrega / BoletaTraslado y sus *Det).

   Convención de la casa:
     - Cabecera PascalCase + detalle con sufijo  Det
     - PK  id<Tabla>  int IDENTITY(1,1)   (pk_<Tabla>)
     - idEstado  FK -> dbo.Estado
     - Encadenamiento por FK:  RecepcionCompra.idOrdenCompra -> OrdenCompra
       (igual que BoletaEntrega.idBoletaSalida, BoletaTraslado.idBoletaEntrega)
     - Pedido<->Orden es N:M: el enlace vive en OrdenCompraDet.idPedidoCompraDet
       (una orden combina líneas de varios pedidos; no hay FK de cabecera).
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
	[esEliminada] [bit] NOT NULL DEFAULT (0),
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
	[esEliminada] [bit] NOT NULL DEFAULT (0),
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
	[lineDiscountPct] [decimal](9, 4) NULL,        -- descuento de línea
	[jobNo] [nvarchar](20) NULL,                   -- proyecto / obra (Job No.)
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
	[esEliminada] [bit] NOT NULL DEFAULT (0),
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
	[precioFactura] [decimal](18, 4) NULL,         -- precio unitario que trae la factura (para verificar vs orden)
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
   CATÁLOGOS (Proveedor, Material, Obra, Maquina) — NO se almacenan en SQL.
   Viven en Business Central. La app los consulta EN VIVO por API al armar el
   pedido / la orden (lookup: GET vendors?search=, GET items?search=).
   Lo único que se persiste es la SELECCIÓN, dentro de los documentos:
   proveedorNo/proveedorNombre, itemNo/descripcion, obra, maquinaNo, grupos
   contables, etc. (snapshot en texto al momento de elegir, igual que Boletas).
   =========================================================================== */

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

/* ===========================================================================
   BITÁCORA DE MOVIMIENTOS — trazabilidad total
   Registra CADA acción y cambio de estado de Pedidos, Órdenes y Recepciones:
   quién, cuándo, qué tipo de movimiento, estado anterior -> nuevo, y el detalle
   (JSON con antes/después). Es la fuente única de auditoría del proceso.
   =========================================================================== */
SET ANSI_NULLS ON
GO
SET QUOTED_IDENTIFIER ON
GO
CREATE TABLE [dbo].[Movimiento](
	[idMovimiento] [int] IDENTITY(1,1) NOT NULL,
	[entidad] [nvarchar](20) NOT NULL,             -- 'pedido' | 'orden' | 'recepcion'
	[idEntidad] [int] NOT NULL,                    -- id del PedidoCompra / OrdenCompra / RecepcionCompra
	[documentoNo] [nvarchar](50) NULL,             -- número visible (PED- / CP- / …)
	[tipoMovimiento] [nvarchar](50) NOT NULL,      -- creado, editado, enviado_aprobacion, aprobado,
	                                               -- rechazado, lanzado, reabierto, recepcion_parcial,
	                                               -- recepcion_total, cambio_precio, cambio_proveedor, anulado…
	[idEstadoAnterior] [int] NULL,
	[idEstadoNuevo] [int] NULL,
	[detalle] [nvarchar](max) NULL,                -- JSON: { campo, antes, despues } o datos del cambio
	[usuario] [nvarchar](100) NOT NULL,
	[rol] [nvarchar](20) NULL,                     -- ingenieria | proveeduria | aprobacion | bodega
	[fecha] [datetime2](7) NOT NULL
) ON [PRIMARY] TEXTIMAGE_ON [PRIMARY]
GO
ALTER TABLE [dbo].[Movimiento] ADD  CONSTRAINT [pk_Movimiento] PRIMARY KEY CLUSTERED ([idMovimiento] ASC) ON [PRIMARY]
GO
ALTER TABLE [dbo].[Movimiento] ADD  CONSTRAINT [df_Movimiento_fecha]  DEFAULT (getdate()) FOR [fecha]
GO
ALTER TABLE [dbo].[Movimiento]  WITH CHECK ADD  CONSTRAINT [ck_Movimiento_entidad] CHECK ([entidad] IN ('pedido','orden','recepcion'))
GO
ALTER TABLE [dbo].[Movimiento]  WITH CHECK ADD  CONSTRAINT [fk_Movimiento_idEstadoAnterior] FOREIGN KEY([idEstadoAnterior]) REFERENCES [dbo].[Estado]([idEstado])
GO
ALTER TABLE [dbo].[Movimiento] CHECK CONSTRAINT [fk_Movimiento_idEstadoAnterior]
GO
ALTER TABLE [dbo].[Movimiento]  WITH CHECK ADD  CONSTRAINT [fk_Movimiento_idEstadoNuevo] FOREIGN KEY([idEstadoNuevo]) REFERENCES [dbo].[Estado]([idEstado])
GO
ALTER TABLE [dbo].[Movimiento] CHECK CONSTRAINT [fk_Movimiento_idEstadoNuevo]
GO

/* ===========================================================================
   ÍNDICES Y UNICIDAD
   --------------------------------------------------------------------------- */

-- Índices en llaves foráneas (SQL Server no los crea solo; aceleran joins/filtros)
CREATE NONCLUSTERED INDEX [ix_PedidoCompra_idEstado]        ON [dbo].[PedidoCompra]([idEstado]);
CREATE NONCLUSTERED INDEX [ix_PedidoCompraDet_idPedido]     ON [dbo].[PedidoCompraDet]([idPedidoCompra]);
CREATE NONCLUSTERED INDEX [ix_OrdenCompra_idEstado]         ON [dbo].[OrdenCompra]([idEstado]);
CREATE NONCLUSTERED INDEX [ix_OrdenCompraDet_idOrden]       ON [dbo].[OrdenCompraDet]([idOrdenCompra]);
CREATE NONCLUSTERED INDEX [ix_OrdenCompraDet_idPedidoDet]   ON [dbo].[OrdenCompraDet]([idPedidoCompraDet]);
CREATE NONCLUSTERED INDEX [ix_RecepcionCompra_idOrden]      ON [dbo].[RecepcionCompra]([idOrdenCompra]);
CREATE NONCLUSTERED INDEX [ix_RecepcionCompraDet_idRecep]   ON [dbo].[RecepcionCompraDet]([idRecepcionCompra]);
CREATE NONCLUSTERED INDEX [ix_RecepcionCompraDet_idOrdenDet] ON [dbo].[RecepcionCompraDet]([idOrdenCompraDet]);
CREATE NONCLUSTERED INDEX [ix_Movimiento_entidad]           ON [dbo].[Movimiento]([entidad],[idEntidad]);
CREATE NONCLUSTERED INDEX [ix_Movimiento_fecha]             ON [dbo].[Movimiento]([fecha] DESC);
GO

-- Números de documento únicos (clave de negocio) — filtrado para no chocar con soft-deletes
CREATE UNIQUE NONCLUSTERED INDEX [ux_PedidoCompra_pedidoNo]   ON [dbo].[PedidoCompra]([pedidoNo])   WHERE [pedidoNo]   IS NOT NULL AND [esEliminada] = 0;
CREATE UNIQUE NONCLUSTERED INDEX [ux_OrdenCompra_ordenNo]     ON [dbo].[OrdenCompra]([ordenNo])     WHERE [ordenNo]     IS NOT NULL AND [esEliminada] = 0;
CREATE UNIQUE NONCLUSTERED INDEX [ux_RecepcionCompra_recepcionNo] ON [dbo].[RecepcionCompra]([recepcionNo]) WHERE [recepcionNo] IS NOT NULL AND [esEliminada] = 0;
GO

-- bcSystemId único por tabla (garantiza el 1:1 con Business Central)
CREATE UNIQUE NONCLUSTERED INDEX [ux_PedidoCompra_bcSystemId]    ON [dbo].[PedidoCompra]([bcSystemId])    WHERE [bcSystemId] IS NOT NULL;
CREATE UNIQUE NONCLUSTERED INDEX [ux_OrdenCompra_bcSystemId]     ON [dbo].[OrdenCompra]([bcSystemId])     WHERE [bcSystemId] IS NOT NULL;
CREATE UNIQUE NONCLUSTERED INDEX [ux_RecepcionCompra_bcSystemId] ON [dbo].[RecepcionCompra]([bcSystemId]) WHERE [bcSystemId] IS NOT NULL;
GO
