-- ============================================================================
--  La Matriz de Ingeniería no puede leer una solicitud ARCHIVADA como ENTREGADO.
--
--  Contexto: desde el feature de "cerrar solicitud", Proveeduría archiva la
--  solicitud que quedó a medias (lo que no se ordenó ya no se compra) poniéndole
--  dbo.PedidoCompra.idEstado = "Cerrado". Ese estado estaba en el modelo desde
--  siempre pero NINGUNA de las dos apps lo escribía, así que su semántica estaba
--  sin estrenar.
--
--  El problema: la vista de la Matriz lo rankea como el estado MÁS AVANZADO —
--
--      CASE e.estado WHEN 'Cerrado' THEN 4 ... END AS rk
--      ...
--      CASE MAX(rk) WHEN 4 THEN 'ENTREGADO' ... END
--
--  — o sea que una solicitud cerrada PORQUE EL MATERIAL YA NO SE VA A COMPRAR le
--  pinta al ingeniero la celda como ENTREGADO. Y por ser el máximo, con MAX() tapa
--  el estado real de los otros pedidos de esa misma celda obra × clasificación.
--  No es un detalle cosmético: es su herramienta de planificación diciendo que
--  llegó material que nadie compró.
--
--  El arreglo: 'Cerrado' pasa a rango 0, o sea NO participa del MAX. Si en la celda
--  hay otros pedidos vivos, manda el de ellos; si la archivada era la única, la
--  celda queda en NULL (que es lo correcto: ahí no hay nada en curso). El resto de
--  la vista queda idéntico.
--
--  OJO — ESTO SOLO ARREGLA LA MITAD SQL. La pantalla de la Matriz en la app de
--  Producción superpone su propio cálculo en el cliente sobre el store de pedidos
--  (app/(protected)/compras/ingenieria/matriz/page.tsx, ~línea 86):
--
--      const EST_DE_CODIGO = { cerrado: "ENTREGADO", en_orden: "COMPRADO", ... }
--
--  Mientras esa línea siga diciendo ENTREGADO, la celda se va a volver a pintar mal
--  en cuanto el store hidrate, aunque esta vista esté corregida. Ese cambio es un
--  commit en el repo Produccion y hay que hacerlo aparte.
--
--  (La otra vista con el mismo CASE, dbo.vw_MatrizObraSubPartida en
--  db/schema_clasificaciones.sql, es la versión vieja por sub_partida y no la lee
--  nadie: las dos apps consultan vw_MatrizObraClasificacion. Se deja como está.)
--
--  Base: la de compras (hoy AdelantePRO; ver la memoria del proyecto).
--  Idempotente: se puede correr las veces que sea.
-- ============================================================================

CREATE OR ALTER VIEW dbo.vw_MatrizObraClasificacion AS
WITH p AS (
    SELECT o.idObra, pc.idClasificacion,
        -- 'Cerrado' = archivada por Proveeduría: rango 0, no participa del MAX.
        CASE e.estado WHEN 'En orden' THEN 3 WHEN 'Aprobado' THEN 2 WHEN 'Borrador' THEN 1 ELSE 0 END AS rk
    FROM dbo.PedidoCompra pc
    JOIN dbo.Estado e ON e.idEstado = pc.idEstado
    JOIN dbo.Obra o   ON o.numeroObra = pc.obra
    WHERE pc.esEliminada = 0 AND pc.idClasificacion IS NOT NULL
)
SELECT idObra, idClasificacion,
    CASE MAX(rk) WHEN 3 THEN 'COMPRADO' WHEN 2 THEN 'PEDIDO' WHEN 1 THEN 'BORRADOR' ELSE NULL END AS estado
FROM p
GROUP BY idObra, idClasificacion;
GO

-- Para ver qué celdas cambian, ANTES de correrlo:
--   SELECT o.numeroObra, pc.idClasificacion, pc.pedidoNo, e.estado
--     FROM dbo.PedidoCompra pc
--     JOIN dbo.Estado e ON e.idEstado = pc.idEstado
--     JOIN dbo.Obra o   ON o.numeroObra = pc.obra
--    WHERE pc.esEliminada = 0 AND pc.idClasificacion IS NOT NULL AND e.estado = 'Cerrado'
--    ORDER BY o.numeroObra;
