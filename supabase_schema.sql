-- Esquema Supabase para "Detección de Parámetros"
-- Genérico: sirve para cualquier producto, cualquier etapa y cualquier parámetro.
-- Ejecutar en: Supabase Dashboard -> SQL Editor -> New query -> Run
--
-- Si ya habías corrido la versión anterior de este archivo, ejecuta en su lugar
-- (o después) el archivo supabase_migration_v2.sql, que sólo agrega lo nuevo.

create extension if not exists "pgcrypto";

create table if not exists batches (
  id uuid primary key default gen_random_uuid(),
  producto text not null,
  lote text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (producto, lote)
);

create table if not exists batch_values (
  id uuid primary key default gen_random_uuid(),
  batch_id uuid not null references batches(id) on delete cascade,
  stage text not null,
  param_id text not null,
  label text,
  section text,
  setpoint text,
  unit text,
  category text,
  value_number numeric,
  value_text text,
  sort_order integer,
  file_name text,
  created_at timestamptz not null default now(),
  unique (batch_id, stage, param_id)
);

create index if not exists idx_batch_values_batch_id on batch_values(batch_id);
create index if not exists idx_batch_values_stage on batch_values(stage);

-- Trigger para mantener updated_at al día en batches
create or replace function set_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

drop trigger if exists trg_batches_updated_at on batches;
create trigger trg_batches_updated_at
  before update on batches
  for each row execute function set_updated_at();

-- RLS: habilitado con acceso abierto de lectura/escritura vía anon key.
-- Ajusta estas políticas si más adelante agregas autenticación de usuarios.
alter table batches enable row level security;
alter table batch_values enable row level security;

drop policy if exists "allow all batches" on batches;
create policy "allow all batches" on batches for all using (true) with check (true);

drop policy if exists "allow all batch_values" on batch_values;
create policy "allow all batch_values" on batch_values for all using (true) with check (true);
