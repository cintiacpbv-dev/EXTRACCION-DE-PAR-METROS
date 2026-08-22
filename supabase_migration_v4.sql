-- Migración v4: órdenes de producción
--
-- La orden trae datos que el registro de manufactura no tiene: el lote de cada
-- material ("Lote ME"), el rendimiento oficial, las fechas exactas de proceso
-- y las firmas de almacén. Se guarda completa como JSON porque su contenido
-- es anidado (insumos, entregas, muestras) y se consume entero al armar el
-- informe de validación.
--
-- Ejecutar UNA vez en: Supabase Dashboard -> SQL Editor -> New query -> Run

create table if not exists batch_orders (
  id uuid primary key default gen_random_uuid(),
  batch_id uuid not null references batches(id) on delete cascade,
  stage text not null,
  orden text,
  producto text,
  data jsonb not null,
  file_name text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (batch_id, stage)
);

create index if not exists idx_batch_orders_batch_id on batch_orders(batch_id);

drop trigger if exists trg_batch_orders_updated_at on batch_orders;
create trigger trg_batch_orders_updated_at
  before update on batch_orders
  for each row execute function set_updated_at();

alter table batch_orders enable row level security;

drop policy if exists "allow all batch_orders" on batch_orders;
create policy "allow all batch_orders" on batch_orders for all using (true) with check (true);
