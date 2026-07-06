/* ============================================================================
   Compras Adelante — CLASIFICACIÓN (control del ingeniero) v2
   Corrige el modelo: la CLASIFICACIÓN no es la sub_partida. Es un catálogo propio
   del ingeniero que puede colgar de una PARTIDA o de una SUB_PARTIDA.
       etapa -> partida -> sub_partida        (WBS, ya existe)
                 \-> clasificacion            (control del ingeniero) <- partida
                        sub_partida -> clasificacion (o de la sub_partida)
   Plantillas y PedidoCompra se amarran a la CLASIFICACIÓN. La matriz por obra
   usa clasificación. Idempotente. Corré primero schema_clasificaciones.sql.
   ============================================================================ */

/* ---- clasificacion: cuelga de partida O de sub_partida (exactamente una) ---- */
IF OBJECT_ID('dbo.clasificacion','U') IS NULL
BEGIN
    CREATE TABLE dbo.clasificacion (
        id             INT IDENTITY(1,1) NOT NULL CONSTRAINT pk_clasificacion PRIMARY KEY,
        nombre         NVARCHAR(160) NOT NULL,
        partida_id     INT NULL,
        sub_partida_id INT NULL,
        activo         BIT NOT NULL CONSTRAINT df_clasificacion_activo DEFAULT(1),
        creado_en      DATETIME2(0) NOT NULL CONSTRAINT df_clasificacion_creado DEFAULT(SYSUTCDATETIME()),
        CONSTRAINT fk_clasificacion_partida     FOREIGN KEY (partida_id)     REFERENCES dbo.partida(id),
        CONSTRAINT fk_clasificacion_subpartida  FOREIGN KEY (sub_partida_id) REFERENCES dbo.sub_partidas(id),
        CONSTRAINT ck_clasificacion_padre CHECK (
            (partida_id IS NOT NULL AND sub_partida_id IS NULL) OR
            (partida_id IS NULL AND sub_partida_id IS NOT NULL)
        )
    );
    CREATE INDEX ix_clasificacion_partida    ON dbo.clasificacion(partida_id);
    CREATE INDEX ix_clasificacion_subpartida ON dbo.clasificacion(sub_partida_id);
END
GO

/* ---- amarre a la app: plantilla y pedido -> clasificacion ------------------- */
IF COL_LENGTH('dbo.PlantillaSolicitud','idClasificacion') IS NULL
    ALTER TABLE dbo.PlantillaSolicitud ADD idClasificacion INT NULL
        CONSTRAINT fk_PlantillaSolicitud_clasificacion FOREIGN KEY (idClasificacion) REFERENCES dbo.clasificacion(id);
GO
IF COL_LENGTH('dbo.PedidoCompra','idClasificacion') IS NULL
    ALTER TABLE dbo.PedidoCompra ADD idClasificacion INT NULL
        CONSTRAINT fk_PedidoCompra_clasificacion FOREIGN KEY (idClasificacion) REFERENCES dbo.clasificacion(id);
GO

/* ---- Matriz por obra × CLASIFICACIÓN, estado derivado del pedido ------------
   dbo.Estado.estado guarda "Borrador"/"Aprobado"/"En orden"/"Cerrado". --------- */
CREATE OR ALTER VIEW dbo.vw_MatrizObraClasificacion AS
WITH p AS (
    SELECT o.idObra, pc.idClasificacion,
        CASE e.estado WHEN 'Cerrado' THEN 4 WHEN 'En orden' THEN 3 WHEN 'Aprobado' THEN 2 WHEN 'Borrador' THEN 1 ELSE 0 END AS rk
    FROM dbo.PedidoCompra pc
    JOIN dbo.Estado e ON e.idEstado = pc.idEstado
    JOIN dbo.Obra o   ON o.numeroObra = pc.obra
    WHERE pc.esEliminada = 0 AND pc.idClasificacion IS NOT NULL
)
SELECT idObra, idClasificacion,
    CASE MAX(rk) WHEN 4 THEN 'ENTREGADO' WHEN 3 THEN 'COMPRADO' WHEN 2 THEN 'PEDIDO' WHEN 1 THEN 'BORRADOR' ELSE NULL END AS estado
FROM p
GROUP BY idObra, idClasificacion;
GO

-- Nota: las columnas idSubPartida (de la v1) quedan sin uso; se pueden dejar.
