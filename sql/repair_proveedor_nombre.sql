/* ============================================================================
   Reparación: OrdenCompra.proveedorNombre que quedó en NULL.

   CAUSA (arreglada en el commit 8b8a5d3): la pantalla de editar buscaba el
   proveedor en el catálogo de BC por `id`, pero la orden trae el CÓDIGO
   ("PROV-000002"). Nunca había match, así que al guardar viajaba
   `proveedorNombre: undefined` y el nombre se perdía. El CÓDIGO sí sobrevivía.
   Síntoma: la orden aparece con proveedor "—" en la lista, y en Reportes sale
   "PROV-001023" en vez del nombre.

   Este script recupera el nombre desde OTRA orden del mismo proveedor que sí lo
   tenga. Es idempotente: solo toca filas con el nombre vacío.

   Correr en la base de la app (AdelanteSBX). Paso 1 para ver qué se va a tocar,
   paso 2 para aplicarlo.
   ============================================================================ */

-- ---------------------------------------------------------------------------
-- PASO 1 — Ver qué órdenes están afectadas y con qué nombre se arreglarían.
--          Si "nombreRecuperado" sale NULL, ese proveedor no tiene ninguna otra
--          orden con nombre: hay que tomarlo de BC (ver nota al final).
-- ---------------------------------------------------------------------------
SELECT
    o.idOrdenCompra,
    o.ordenNo,
    o.proveedorNo,
    o.proveedorNombre               AS nombreActual,
    v.nombre                        AS nombreRecuperado,
    o.fechaModificacion,
    o.modificadoPor
FROM dbo.OrdenCompra o
OUTER APPLY (
    SELECT MAX(x.proveedorNombre) AS nombre
    FROM dbo.OrdenCompra x
    WHERE x.proveedorNo = o.proveedorNo
      AND NULLIF(LTRIM(RTRIM(x.proveedorNombre)), '') IS NOT NULL
) v
WHERE o.esEliminada = 0
  AND NULLIF(LTRIM(RTRIM(o.proveedorNombre)), '') IS NULL
  AND NULLIF(LTRIM(RTRIM(o.proveedorNo)), '') IS NOT NULL
ORDER BY o.idOrdenCompra DESC;

-- ---------------------------------------------------------------------------
-- PASO 2 — Aplicar. Solo escribe donde hay un nombre que recuperar.
--          Deja rastro en modificadoPor para poder auditarlo después.
-- ---------------------------------------------------------------------------
BEGIN TRANSACTION;

UPDATE o
SET o.proveedorNombre  = v.nombre,
    o.fechaModificacion = getdate(),
    o.modificadoPor     = 'repair-proveedorNombre'
FROM dbo.OrdenCompra o
CROSS APPLY (
    SELECT MAX(x.proveedorNombre) AS nombre
    FROM dbo.OrdenCompra x
    WHERE x.proveedorNo = o.proveedorNo
      AND NULLIF(LTRIM(RTRIM(x.proveedorNombre)), '') IS NOT NULL
) v
WHERE o.esEliminada = 0
  AND NULLIF(LTRIM(RTRIM(o.proveedorNombre)), '') IS NULL
  AND NULLIF(LTRIM(RTRIM(o.proveedorNo)), '') IS NOT NULL
  AND v.nombre IS NOT NULL;

-- Revisá el conteo antes de confirmar.
SELECT @@ROWCOUNT AS filasArregladas;

-- COMMIT TRANSACTION;     -- descomentar cuando el conteo tenga sentido
-- ROLLBACK TRANSACTION;   -- si algo no cuadra

/* ---------------------------------------------------------------------------
   Las que queden en NULL después de esto son de proveedores que NO tienen otra
   orden con nombre. Para esas hay dos caminos:
     a) Abrir la orden en la app, tocar "Editar", reelegir el proveedor (ya sale
        preseleccionado desde el fix) y guardar: escribe el nombre desde BC.
     b) Sacar el nombre de BC (Proveedores → el PROV-…) y ponerlo a mano.
   --------------------------------------------------------------------------- */
