-- Migración v10: equipos que intervinieron en cada etapa
--
-- El registro de manufactura declara, en su sección 1, qué máquinas se usaron
-- en la etapa. Ese listado es la base del Formato 3 (verificación de la
-- calificación de equipos), que hay que poder rehacer sin volver a procesar
-- los PDF: por eso se guarda junto al resto del análisis.
--
-- Mismo patrón que batch_insumos (migración v6): una fila por lote y etapa,
-- con la lista completa en JSON.
--
-- Ejecutar UNA vez en: Supabase Dashboard -> SQL Editor -> New query -> Run

create table if not exists batch_equipos (
  id uuid primary key default gen_random_uuid(),
  batch_id uuid not null references batches(id) on delete cascade,
  stage text not null,
  data jsonb not null,
  file_name text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (batch_id, stage)
);

alter table batch_equipos enable row level security;

drop policy if exists "allow all batch_equipos" on batch_equipos;
create policy "allow all batch_equipos" on batch_equipos for all using (true) with check (true);
