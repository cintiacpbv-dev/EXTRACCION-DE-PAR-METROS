-- Migración v14: historial de los análisis de riesgo (AMFE)
--
-- Hasta ahora un análisis de riesgo vivía sólo en la pantalla: al recargar la
-- página se perdía el borrador y, peor, las correcciones hechas a mano encima
-- —que son el trabajo de verdad, el que se revisa y se firma—.
--
-- Cada análisis se guarda entero, con sus filas en JSON: el cuadro se edita
-- como una unidad (se añaden filas, se corrigen textos, se ajustan S/O/D) y
-- separarlo en una tabla por fila obligaría a reescribirlas todas en cada
-- cambio sin ganar nada, porque nunca se consultan sueltas.
--
-- "filas_total" está repetido a propósito: permite enseñar "42 filas" en la
-- lista del historial sin traerse el cuadro completo de cada análisis.
--
-- Ejecutar UNA vez en: Supabase Dashboard -> SQL Editor -> New query -> Run

create table if not exists analisis_riesgo (
  id text primary key,
  producto text not null default '',
  etapas text not null default '',
  nombre text not null default '',
  filas jsonb not null default '[]'::jsonb,
  filas_total integer not null default 0,
  creado timestamptz not null default now(),
  actualizado timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- El historial se lista por fecha, del más reciente al más antiguo.
create index if not exists idx_analisis_riesgo_actualizado
  on analisis_riesgo (actualizado desc);

drop trigger if exists trg_analisis_riesgo_updated_at on analisis_riesgo;
create trigger trg_analisis_riesgo_updated_at
  before update on analisis_riesgo
  for each row execute function set_updated_at();

alter table analisis_riesgo enable row level security;

drop policy if exists "allow all analisis_riesgo" on analisis_riesgo;
create policy "allow all analisis_riesgo" on analisis_riesgo
  for all using (true) with check (true);
