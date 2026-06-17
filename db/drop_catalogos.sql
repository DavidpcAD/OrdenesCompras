/* ============================================================================
   OPCIONAL — Quita las 4 tablas de catálogo que ya NO se usan.
   Proveedor, Material, Obra y Maquina viven en Business Central y se consultan
   por API; no se almacenan en SQL. Ninguna otra tabla las referencia (no hay
   FKs hacia ellas), así que borrarlas es seguro.
   Si preferís dejarlas, no pasa nada: son tablas vacías que nadie usa.
   ============================================================================ */
IF OBJECT_ID('dbo.Proveedor','U') IS NOT NULL DROP TABLE [dbo].[Proveedor];
IF OBJECT_ID('dbo.Material','U')  IS NOT NULL DROP TABLE [dbo].[Material];
IF OBJECT_ID('dbo.Obra','U')      IS NOT NULL DROP TABLE [dbo].[Obra];
IF OBJECT_ID('dbo.Maquina','U')   IS NOT NULL DROP TABLE [dbo].[Maquina];
GO
