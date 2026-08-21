-- Migración v2: parámetros genéricos (cualquier producto / etapa / parámetro)
--
-- Ejecutar UNA vez en: Supabase Dashboard -> SQL Editor -> New query -> Run
-- Es segura de re-ejecutar: todo va con IF NOT EXISTS / IF EXISTS.

-- 1. Nuevas columnas descriptivas del parámetro detectado
alter table batch_values add column if not exists label       text;
alter table batch_values add column if not exists section     text;
alter table batch_values add column if not exists setpoint    text;
alter table batch_values add column if not exists unit        text;
alter table batch_values add column if not exists category    text;
alter table batch_values add column if not exists sort_order  integer;

-- 2. La etapa ya no está restringida a Fabricación/Envase/Acondicionado:
--    ahora admite Inspección, Recubrimiento o cualquier etapa futura.
alter table batch_values drop constraint if exists batch_values_stage_check;

-- 3. Las órdenes viven ahora junto a cada etapa, no en la cabecera del lote
alter table batches drop column if exists orden_fabricacion;
alter table batches drop column if exists orden_envase;
alter table batches drop column if exists orden_acondicionado;

-- 4. Índice para filtrar por etapa
create index if not exists idx_batch_values_stage on batch_values(stage);

-- 5. Los datos cargados con la versión anterior no traen etiqueta ni sección;
--    se limpian para que se vuelvan a generar al reprocesar los PDF.
delete from batch_values where label is null;
