-- ============================================================================
-- "¿CUÁLES DE LAS APROBADAS EL VIERNES YA SE LE MANDARON AL PROVEEDOR?"
--
-- Angie, 14 de septiembre de 2026: Luis Ro le dejó 60 órdenes aprobadas de una
-- sola vez, alcanzó a mandar como 3, y no había forma de saber cuáles faltaban.
-- La app ahora marca la orden cuando el PDF se descarga (y también a mano), y
-- filtra la lista por la FECHA DE APROBACIÓN.
--
-- Este script NO crea columnas: las dos cosas salen de dbo.Movimiento, que ya
-- existe. Lo que hace es (1) un índice para que esa lectura no barra la tabla en
-- cada carga y (2) dejar a mano las consultas de diagnóstico.
--
-- La app funciona SIN correr esto: el índice es de rendimiento, no de correctitud.
-- Correr en AdelantePRO. Idempotente.
-- ============================================================================

-- 1) ÍNDICE. En cada bootstrap se leen, por orden, el último movimiento de
-- aprobación y el último de envío al proveedor. Sin índice eso es un scan de
-- toda la bitácora; con él, un seek por entidad='orden'.
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'ix_Movimiento_entidad_tipo' AND object_id = OBJECT_ID('dbo.Movimiento'))
BEGIN
    CREATE NONCLUSTERED INDEX ix_Movimiento_entidad_tipo
        ON dbo.Movimiento (entidad, tipoMovimiento)
        INCLUDE (idEntidad, fecha, usuario, idEstadoNuevo);
END
GO

-- ============================================================================
-- 2) DIAGNÓSTICO — de dónde está saliendo la fecha de aprobación
--
-- La app la toma de dbo.OrdenCompra.fechaAprobado si está llena y, si no, del
-- movimiento de aprobación que deja la app de Producción. Estas consultas dicen
-- cuál de las dos tiene los datos DE VERDAD (y por eso no se puede saber desde
-- el código: la escribe la otra app).
-- ============================================================================

-- 2.a ¿Cuántas órdenes lanzadas/completadas traen fechaAprobado en la columna?
SELECT  e.nombre                                        AS estado,
        COUNT(*)                                        AS ordenes,
        SUM(CASE WHEN o.fechaAprobado IS NOT NULL THEN 1 ELSE 0 END) AS con_fechaAprobado,
        SUM(CASE WHEN o.aprobadoPor  IS NOT NULL THEN 1 ELSE 0 END) AS con_aprobadoPor
  FROM dbo.OrdenCompra o
  LEFT JOIN dbo.Estado e ON e.idEstado = o.idEstado
 WHERE o.esEliminada = 0
 GROUP BY e.nombre
 ORDER BY ordenes DESC;

-- 2.b ¿Con qué tipoMovimiento escribe la aprobación la app de Producción?
-- (Si acá no aparece nada parecido a "aprobado"/"lanzado", la fecha tiene que
-- salir sí o sí de la columna fechaAprobado.)
SELECT  tipoMovimiento, COUNT(*) AS veces, MIN(fecha) AS desde, MAX(fecha) AS hasta
  FROM dbo.Movimiento
 WHERE entidad = 'orden'
 GROUP BY tipoMovimiento
 ORDER BY veces DESC;

-- 2.c Las órdenes aprobadas en un día concreto (el ejemplo: viernes 11/09/2026),
-- con la marca de envío al proveedor. Es exactamente lo que la pantalla muestra.
DECLARE @desde date = '2026-09-11', @hasta date = '2026-09-11';
WITH sellos AS (
    SELECT  idEntidad,
            MAX(CASE WHEN (tipoMovimiento LIKE '%aprob%' AND tipoMovimiento NOT LIKE '%envi%')
                       OR tipoMovimiento LIKE '%lanz%' THEN fecha END)              AS aprobada,
            MAX(CASE WHEN tipoMovimiento IN ('pdf_proveedor','enviada_proveedor') THEN fecha END) AS enviada,
            MAX(CASE WHEN tipoMovimiento = 'envio_deshecho' THEN fecha END)         AS desmarcada
      FROM dbo.Movimiento
     WHERE entidad = 'orden'
     GROUP BY idEntidad
)
SELECT  o.ordenNo, o.bcNo, o.proveedorNombre,
        COALESCE(o.fechaAprobado, s.aprobada) AS aprobada_el,
        s.enviada                             AS pdf_o_marca,
        CASE WHEN s.enviada IS NOT NULL AND (s.desmarcada IS NULL OR s.desmarcada < s.enviada)
             THEN 'sí' ELSE 'NO' END          AS ya_se_mando
  FROM dbo.OrdenCompra o
  LEFT JOIN sellos s ON s.idEntidad = o.idOrdenCompra
 WHERE o.esEliminada = 0
   AND CAST(COALESCE(o.fechaAprobado, s.aprobada) AS date) BETWEEN @desde AND @hasta
 ORDER BY aprobada_el;
