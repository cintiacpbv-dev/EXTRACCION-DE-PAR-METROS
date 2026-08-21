-- Migración v3: participantes del proceso (operarios y supervisores)
--
-- Ejecutar UNA vez en: Supabase Dashboard -> SQL Editor -> New query -> Run

create table if not exists batch_personnel (
  id uuid primary key default gen_random_uuid(),
  batch_id uuid not null references batches(id) on delete cascade,
  stage text not null,
  role text not null check (role in ('operario', 'supervisor')),
  name text not null,
  count integer not null default 1,
  created_at timestamptz not null default now(),
  unique (batch_id, stage, role, name)
);

create index if not exists idx_batch_personnel_batch_id on batch_personnel(batch_id);

alter table batch_personnel enable row level security;

drop policy if exists "allow all batch_personnel" on batch_personnel;
create policy "allow all batch_personnel" on batch_personnel for all using (true) with check (true);
