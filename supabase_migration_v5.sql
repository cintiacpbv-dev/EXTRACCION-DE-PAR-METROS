-- Migración v5: receta (código de producto) en batches
--
-- La receta es el código de producto de 10 dígitos del encabezado del
-- registro ("6000003270"). No tenía dónde guardarse: se calculaba al vuelo
-- en el navegador y se perdía al recargar la página o al abrir desde otra
-- computadora, salvo que hubiera una orden de producción cargada para ese
-- mismo lote. Se agrega como columna de "batches" para que quede disponible
-- igual que el producto y el lote.
--
-- Ejecutar UNA vez en: Supabase Dashboard -> SQL Editor -> New query -> Run

alter table batches add column if not exists receta text;
