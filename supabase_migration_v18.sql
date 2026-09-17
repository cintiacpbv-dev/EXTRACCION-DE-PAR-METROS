-- Migración v18: la severidad de cada atributo de calidad
--
-- La severidad es la pieza que decide todo el Procedimiento de Evaluación de
-- Criticidad: un parámetro con sospecha de impacto sobre un atributo de
-- severidad 4 o 5 es Crítico automático, sin evaluar nada más.
--
-- Y es una propiedad DEL ATRIBUTO, no del producto: "qué tan grave sería que
-- la dureza saliera fuera de especificación" se contesta una vez y vale para
-- todas las tabletas de la planta. Eso es lo que dice el Paso 1 del
-- procedimiento —"fijar, una sola vez por atributo, de forma independiente de
-- cualquier parámetro de proceso"— y por eso esta tabla no lleva producto: si
-- lo llevara, el mismo atributo podría acabar con dos severidades distintas
-- según quién corriera la evaluación, que es justo lo que hay que impedir.
--
-- La clave es el nombre normalizado, con su calificativo incluido. En las
-- corridas reales el Paso 1 parte "Descripción" e "Identidad" en dos filas
-- con severidades distintas ("— empaque primario" 4, "— empaque secundario"
-- 3): son dos atributos, no uno, y tienen que poder convivir.
--
-- `origen` distingue lo propuesto por la IA de lo revisado por una persona.
-- Una severidad revisada no vuelve a ser pisada por el modelo.
--
-- Ejecutar UNA vez en: Supabase Dashboard -> SQL Editor -> New query -> Run

create table if not exists severidad_atributos (
  clave text primary key,
  atributo text not null,
  severidad integer not null check (severidad between 1 and 5),
  justificacion text,
  decision text,
  origen text not null default 'ia',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

drop trigger if exists trg_severidad_updated_at on severidad_atributos;
create trigger trg_severidad_updated_at
  before update on severidad_atributos
  for each row execute function set_updated_at();

alter table severidad_atributos enable row level security;

drop policy if exists "allow all severidad_atributos" on severidad_atributos;
create policy "allow all severidad_atributos" on severidad_atributos
  for all using (true) with check (true);
