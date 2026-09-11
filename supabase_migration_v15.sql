-- Migración v15: el consolidado de calificación del personal, guardado de verdad
--
-- El Formato 8 necesita el consolidado (el Excel con una hoja por sección y
-- una fila por persona y rol) para poner la etapa donde interviene cada quien
-- y la fecha en que se calificó. Hasta ahora ese libro sólo vivía en el
-- navegador que lo subió: se perdía al limpiar los datos del sitio, no estaba
-- en la computadora de al lado, y obligaba a volver a subir un archivo que no
-- había cambiado.
--
-- Subirlo sigue siendo manual —se hace cuando el consolidado se actualiza—,
-- pero una vez subido se queda.
--
-- Hay uno solo para toda la planta: no es de un producto ni de un lote, así
-- que la tabla guarda una única fila (clave = 'personal') y cada carga nueva
-- reemplaza a la anterior. Es la misma forma que la v13 le dio al cronograma
-- de equipos, y por el mismo motivo.
--
-- Se guarda ya leído, en JSON, y no el .xlsx original. Dos razones: lo que
-- hace falta para el Formato 8 son sus filas, y el libro real pesa 2,8 MB
-- mientras que sus 555 filas ocupan 108 KB. Además, interpretarlo es lo caro
-- —ExcelJS tarda casi cinco minutos en abrir ese libro— y así se hace una vez
-- y no en cada carga de la página.
--
-- Ejecutar UNA vez en: Supabase Dashboard -> SQL Editor -> New query -> Run

create table if not exists personal_calificacion (
  clave text primary key,
  personal jsonb not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

drop trigger if exists trg_personal_updated_at on personal_calificacion;
create trigger trg_personal_updated_at
  before update on personal_calificacion
  for each row execute function set_updated_at();

alter table personal_calificacion enable row level security;

drop policy if exists "allow all personal_calificacion" on personal_calificacion;
create policy "allow all personal_calificacion" on personal_calificacion
  for all using (true) with check (true);
