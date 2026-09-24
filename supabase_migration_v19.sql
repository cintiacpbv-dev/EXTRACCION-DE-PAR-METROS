-- Migración v19: historial de las evaluaciones de Criticidad y Riesgo
--
-- Una evaluación de criticidad es cara de repetir —una pregunta a Consulta
-- PDF y a la IA por atributo y por parámetro— y lo que vale de ella es lo que
-- se ajustó a mano encima: severidades, respuestas de desempeño, sugerencias
-- aceptadas. Aquí se guarda entera, para volver a abrirla tal como quedó y
-- volver a emitir su Word o su Excel sin repetir la corrida.
--
-- Como en analisis_riesgo (v14), la evaluación se guarda como una unidad en
-- JSON ("datos"): se abre y se reescribe entera, nunca se consulta por filas.
-- "resumen" va aparte para enseñar "112 parámetros · 35 Críticos" en la lista
-- sin traerse los datos de cada evaluación.
--
-- Ejecutar UNA vez en: Supabase Dashboard -> SQL Editor -> New query -> Run

create table if not exists analisis_criticidad (
  id text primary key,
  producto text not null default '',
  nombre text not null default '',
  fuente text not null default '',
  resumen jsonb not null default '{}'::jsonb,
  datos jsonb not null default '{}'::jsonb,
  creado timestamptz not null default now(),
  actualizado timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- El historial se lista por fecha, del más reciente al más antiguo.
create index if not exists idx_analisis_criticidad_actualizado
  on analisis_criticidad (actualizado desc);

drop trigger if exists trg_analisis_criticidad_updated_at on analisis_criticidad;
create trigger trg_analisis_criticidad_updated_at
  before update on analisis_criticidad
  for each row execute function set_updated_at();

alter table analisis_criticidad enable row level security;

drop policy if exists "allow all analisis_criticidad" on analisis_criticidad;
create policy "allow all analisis_criticidad" on analisis_criticidad
  for all using (true) with check (true);
