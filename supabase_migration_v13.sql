-- Migración v13: el cronograma de calificación de equipos, guardado de verdad
--
-- El Formato 3 necesita el cronograma (el Excel de OQ y PQ) para poner el
-- estado, el código de calificación y la fecha de cada equipo. Hasta ahora ese
-- libro sólo vivía en el navegador que lo subió: se perdía al limpiar los
-- datos del sitio, no estaba en la computadora de al lado, y obligaba a volver
-- a subir un archivo que no había cambiado.
--
-- Subirlo sigue siendo manual —se hace cuando el cronograma se actualiza—,
-- pero una vez subido se queda.
--
-- Hay uno solo para toda la planta: no es de un producto ni de un lote, así
-- que la tabla guarda una única fila (clave = 'cronograma') y cada carga
-- nueva reemplaza a la anterior. Se guarda ya leído, en JSON, y no el .xlsx
-- original: lo que hace falta para el Formato 3 son sus filas, y así se evita
-- volver a interpretar el libro en cada carga de la página.
--
-- Ejecutar UNA vez en: Supabase Dashboard -> SQL Editor -> New query -> Run

create table if not exists cronograma_calificacion (
  clave text primary key,
  cronograma jsonb not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

drop trigger if exists trg_cronograma_updated_at on cronograma_calificacion;
create trigger trg_cronograma_updated_at
  before update on cronograma_calificacion
  for each row execute function set_updated_at();

alter table cronograma_calificacion enable row level security;

drop policy if exists "allow all cronograma_calificacion" on cronograma_calificacion;
create policy "allow all cronograma_calificacion" on cronograma_calificacion
  for all using (true) with check (true);
