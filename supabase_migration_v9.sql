-- Migración v9: tamaño de lote
--
-- Un mismo producto se fabrica en más de una escala: EVACLEAN tiene lotes de
-- 200 kg y de 390 kg, y cada escala es una validación distinta, con sus
-- propios lotes, sus propios cuadros y su propio protocolo. Mezclarlas en un
-- solo análisis compara entre sí lotes que no son comparables.
--
-- El tamaño lo declara el encabezado del registro ("Teórico: 390.000 kg") y
-- se guarda por lote, que es su grano: un lote se fabrica entero a una escala.
--
-- Ejecutar UNA vez en: Supabase Dashboard -> SQL Editor -> New query -> Run

alter table batches add column if not exists teorico text;
alter table batches add column if not exists teorico_unidad text;
