-- Migración v6: materiales de la sección INSUMOS del registro
--
-- El lector dedicado de la tabla de insumos (parsers/insumos.js) reemplaza al
-- detector genérico para esa sección, que no captura sus filas. Se guarda
-- completa como JSON, igual que la orden de producción, porque se consume
-- entera al armar el cuadro de materiales.
--
-- Ejecutar UNA vez en: Supabase Dashboard -> SQL Editor -> New query -> Run

create table if not exists batch_insumos (
  id uuid primary key default gen_random_uuid(),
  batch_id uuid not null references batches(id) on delete cascade,
  stage text not null,
  data jsonb not null,
  file_name text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (batch_id, stage)
);

create index if not exists idx_batch_insumos_batch_id on batch_insumos(batch_id);

drop trigger if exists trg_batch_insumos_updated_at on batch_insumos;
create trigger trg_batch_insumos_updated_at
  before update on batch_insumos
  for each row execute function set_updated_at();

alter table batch_insumos enable row level security;

drop policy if exists "allow all batch_insumos" on batch_insumos;
create policy "allow all batch_insumos" on batch_insumos for all using (true) with check (true);
