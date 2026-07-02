/* ============================================================================
   Compras Adelante — WBS: ETAPA -> PARTIDA -> SUB_PARTIDA  (+ amarre a plantillas/pedidos)
   Alineado a la convención REAL de tu base (snake_case, igual que dbo.sub_partidas):
       id INT IDENTITY, codigo, nombre, <padre>_id, activo, creado_en

   Jerarquía (del Excel "Tareas obras"):
       etapa        1        OBRA GRIS / ACABADOS / ELECTROMECANICO      [NUEVO]
         └─ partida   1.1      FUNDACIONES, MUROS, ENCHAPES, …            [NUEVO]
              └─ sub_partida  1.1.1  TRAZADO Y RELLENOS, …                [YA EXISTE: dbo.sub_partidas]
                   └─ Plantilla de pedido  (idSubPartida)                 [se amplía]
                        └─ PedidoCompra     (idSubPartida)                 [se amplía]

   "Clasificación" del prototipo = SUB_PARTIDA (el nivel 1.1.1).
   La "Matriz por obra" NO es tabla: es una VISTA (obra × sub_partida) con el
   estado derivado del pedido. Idempotente: se puede correr varias veces.

   NOTA: si ya corriste la versión anterior (tablas Agrupador/Clasificacion),
   podés borrarlas al final (bloque comentado). No las usa este esquema.
   ============================================================================ */

/* ---- 1) etapa (NUEVO) — nivel de 1 número ---------------------------------- */
IF OBJECT_ID('dbo.etapa','U') IS NULL
BEGIN
    CREATE TABLE dbo.etapa (
        id           INT IDENTITY(1,1) NOT NULL CONSTRAINT pk_etapa PRIMARY KEY,
        codigo       VARCHAR(10)    NOT NULL,          -- '1', '2', '3'
        nombre       NVARCHAR(120)  NOT NULL,          -- 'OBRA GRIS'
        activo       BIT            NOT NULL CONSTRAINT df_etapa_activo DEFAULT(1),
        creado_en    DATETIME2(0)   NOT NULL CONSTRAINT df_etapa_creado DEFAULT(SYSUTCDATETIME()),
        CONSTRAINT uq_etapa_codigo UNIQUE (codigo)
    );
END
GO

/* ---- 2) partida (NUEVO) — nivel de 2 números (1.1), cuelga de etapa -------- */
IF OBJECT_ID('dbo.partida','U') IS NULL
BEGIN
    CREATE TABLE dbo.partida (
        id           INT IDENTITY(1,1) NOT NULL CONSTRAINT pk_partida PRIMARY KEY,
        codigo       VARCHAR(15)    NOT NULL,          -- '1.1'
        nombre       NVARCHAR(160)  NOT NULL,          -- 'FUNDACIONES'
        etapa_id     INT            NULL,
        activo       BIT            NOT NULL CONSTRAINT df_partida_activo DEFAULT(1),
        creado_en    DATETIME2(0)   NOT NULL CONSTRAINT df_partida_creado DEFAULT(SYSUTCDATETIME()),
        CONSTRAINT uq_partida_codigo UNIQUE (codigo),
        CONSTRAINT fk_partida_etapa FOREIGN KEY (etapa_id) REFERENCES dbo.etapa(id)
    );
END
GO

/* ---- 3) SEED etapa (3) + partida (16) — datos reales del Excel ------------- */
INSERT INTO dbo.etapa (codigo, nombre)
SELECT v.codigo, v.nombre FROM (VALUES
    ('1', N'OBRA GRIS'), ('2', N'ACABADOS'), ('3', N'ELECTROMECANICO')
) v(codigo,nombre)
WHERE NOT EXISTS (SELECT 1 FROM dbo.etapa e WHERE e.codigo = v.codigo);
GO

INSERT INTO dbo.partida (codigo, nombre, etapa_id)
SELECT v.codigo, v.nombre, e.id
FROM (VALUES
    ('1.1', N'FUNDACIONES', '1'),
    ('1.2', N'MUROS N1 & N2, ENTREPISO & AZOTEA', '1'),
    ('1.3', N'ESTRUCTURA METÁLICA Y CUBIERTAS', '1'),
    ('1.4', N'HOJALATERIA', '1'),
    ('1.5', N'OBRAS COMPLEMENTARIAS', '1'),
    ('1.6', N'LIVIANO', '1'),
    ('2.1', N'REPELLOS & EMPASTE', '2'),
    ('2.2', N'ENCHAPES', '2'),
    ('2.3', N'PINTURA / IMPERMEABILIZANTE', '2'),
    ('2.4', N'MADERAS', '2'),
    ('2.5', N'VENTANERIA', '2'),
    ('2.6', N'MUEBLES Y PUERTAS', '2'),
    ('2.7', N'LOSA SANITARIA, GRIFERIA', '2'),
    ('2.8', N'ZACATE', '2'),
    ('3.1', N'ELÉCTRICO', '3'),
    ('3.2', N'MECÁNICO', '3')
) v(codigo,nombre,etapaCod)
JOIN dbo.etapa e ON e.codigo = v.etapaCod
WHERE NOT EXISTS (SELECT 1 FROM dbo.partida p WHERE p.codigo = v.codigo);
GO

/* ---- 4) sub_partidas (YA EXISTE): re-enlazar partida_id por el CÓDIGO -------
   Deriva la partida del código de la sub-partida ('1.1.1' -> '1.1') y corrige
   partida_id, sin importar el valor previo. Filas cuyo código no calce quedan igual. */
UPDATE s
   SET s.partida_id = p.id
FROM dbo.sub_partidas s
JOIN dbo.partida p
  ON p.codigo = LEFT(LTRIM(RTRIM(s.codigo)),
                     LEN(LTRIM(RTRIM(s.codigo))) - CHARINDEX('.', REVERSE(LTRIM(RTRIM(s.codigo)))));
GO
-- FK sub_partidas -> partida (WITH NOCHECK: no valida filas históricas que no calcen)
IF NOT EXISTS (SELECT 1 FROM sys.foreign_keys WHERE name = 'fk_sub_partidas_partida')
    ALTER TABLE dbo.sub_partidas WITH NOCHECK
        ADD CONSTRAINT fk_sub_partidas_partida FOREIGN KEY (partida_id) REFERENCES dbo.partida(id);
GO

/* ---- 5) Amarre a la app: plantilla y pedido apuntan a una SUB_PARTIDA ------- */
IF COL_LENGTH('dbo.PlantillaSolicitud','idSubPartida') IS NULL
    ALTER TABLE dbo.PlantillaSolicitud ADD idSubPartida INT NULL
        CONSTRAINT fk_PlantillaSolicitud_subPartida FOREIGN KEY (idSubPartida) REFERENCES dbo.sub_partidas(id);
GO
IF COL_LENGTH('dbo.PedidoCompra','idSubPartida') IS NULL
    ALTER TABLE dbo.PedidoCompra ADD idSubPartida INT NULL
        CONSTRAINT fk_PedidoCompra_subPartida FOREIGN KEY (idSubPartida) REFERENCES dbo.sub_partidas(id);
GO

/* ---- 6) VISTA Matriz por obra: dbo.Obra × sub_partida, estado DERIVADO del pedido.
   Las obras salen de dbo.Obra (espejo de BC; su sync es tema aparte). Se enlaza el
   pedido a la obra por numeroObra = PedidoCompra.obra (el código que ya guarda la app).
   La vista devuelve SOLO las celdas con estado; el grid arma las filas (obras) y
   columnas (sub_partidas) desde sus catálogos y rellena el resto con "+".
   dbo.Estado es compartida con boletas: la columna del nombre se llama `estado`
   (no `nombre`) y guarda "Borrador"/"Aprobado"/"En orden"/"Cerrado".
   OJO: confirmá que dbo.Obra.numeroObra coincida con lo que la app guarda en
   PedidoCompra.obra; si no, ese es el punto a alinear. -------------------------- */
CREATE OR ALTER VIEW dbo.vw_MatrizObraSubPartida AS
WITH p AS (
    SELECT o.idObra, o.numeroObra, o.nombreMostrado, pc.idSubPartida,
        CASE e.estado WHEN 'Cerrado' THEN 4 WHEN 'En orden' THEN 3 WHEN 'Aprobado' THEN 2 WHEN 'Borrador' THEN 1 ELSE 0 END AS rk
    FROM dbo.PedidoCompra pc
    JOIN dbo.Estado e ON e.idEstado = pc.idEstado
    JOIN dbo.Obra o   ON o.numeroObra = pc.obra
    WHERE pc.esEliminada = 0 AND pc.idSubPartida IS NOT NULL
)
SELECT idObra, numeroObra, nombreMostrado, idSubPartida,
    CASE MAX(rk) WHEN 4 THEN 'ENTREGADO' WHEN 3 THEN 'COMPRADO' WHEN 2 THEN 'PEDIDO' WHEN 1 THEN 'BORRADOR' ELSE NULL END AS estado
FROM p
GROUP BY idObra, numeroObra, nombreMostrado, idSubPartida;
GO

/* ---- Verificación rápida (opcional) --------------------------------------- */
-- SELECT (SELECT COUNT(*) FROM dbo.etapa) AS etapas,
--        (SELECT COUNT(*) FROM dbo.partida) AS partidas,
--        (SELECT COUNT(*) FROM dbo.sub_partidas WHERE partida_id NOT IN (SELECT id FROM dbo.partida)) AS subs_sin_partida;

/* ---- Limpieza de la versión anterior (SOLO si la corriste) ------------------
IF OBJECT_ID('dbo.Clasificacion','U') IS NOT NULL DROP TABLE dbo.Clasificacion;
IF OBJECT_ID('dbo.Agrupador','U')     IS NOT NULL DROP TABLE dbo.Agrupador;
-- (Partida/PascalCase del borrador schema_planificacion.sql es el MISMO objeto
--  que dbo.partida por ser SQL Server case-insensitive; no la borres.)
------------------------------------------------------------------------------- */
