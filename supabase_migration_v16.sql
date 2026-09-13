-- Migración v16: el vocabulario de parámetros que la aplicación aprende sola
--
-- El detector decide que una lectura del registro es un parámetro de proceso
-- por dos vías: porque el documento le imprime un criterio de aceptación al
-- lado, o porque su etiqueta nombra una magnitud conocida. Esa segunda lista
-- (PROCESS_KEYWORDS, en parsers/genericParser.js) está escrita a mano, y su
-- propio comentario dice lo que pasa: "el vocabulario de sólidos orales no
-- sirve para un inyectable estéril… esto crece con cada documento nuevo".
--
-- Crecer a mano significa que llega un producto de una familia nueva, sus
-- lecturas caen en "otros", y alguien tiene que editar el código y volver a
-- desplegar. Con esta tabla, el primer registro de cada receta y etapa nuevas
-- se le pasa a Gemini, que dice cuáles de las lecturas sueltas son magnitudes
-- de proceso, y el término se guarda AQUÍ: desde entonces vale para todos los
-- equipos y para todos los registros parecidos, sin tocar el código.
--
-- Tres cosas de la forma de la tabla, que no son casuales:
--
--   * La clave es el término normalizado (mayúsculas, sin acentos), así que
--     aprender dos veces lo mismo no duplica filas.
--   * Cada fila deja rastro: de qué producto, receta, etapa y etiqueta exacta
--     salió el término. En un expediente de validación no vale "lo decidió la
--     máquina" — tiene que constar por qué, y tiene que poder revisarse.
--   * `origen` distingue lo propuesto por la IA de lo escrito por una persona,
--     porque no merecen la misma confianza al revisarlos.
--
-- Lo aprendido SÓLO SUMA: puede ascender a parámetro de proceso una lectura
-- que hoy queda en "otros", y nunca puede quitar ni cambiar nada de lo que ya
-- se detectaba. Borrar una fila de aquí devuelve la detección a como estaba.
--
-- Ejecutar UNA vez en: Supabase Dashboard -> SQL Editor -> New query -> Run

create table if not exists vocabulario_parametros (
  termino text primary key,
  etiqueta text,
  producto text,
  receta text,
  etapa text,
  origen text not null default 'ia',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

drop trigger if exists trg_vocabulario_updated_at on vocabulario_parametros;
create trigger trg_vocabulario_updated_at
  before update on vocabulario_parametros
  for each row execute function set_updated_at();

alter table vocabulario_parametros enable row level security;

drop policy if exists "allow all vocabulario_parametros" on vocabulario_parametros;
create policy "allow all vocabulario_parametros" on vocabulario_parametros
  for all using (true) with check (true);

-- Qué recetas y etapas ya se revisaron, para no volver a gastar una llamada a
-- la IA en un registro equivalente al que ya se aprendió. Es lo que hace que
-- "basta con analizar un registro por cada versión y etapa" sea cierto: la
-- marca queda puesta aunque esa revisión no haya encontrado ningún término
-- nuevo, que es el caso normal a partir del segundo lote.
create table if not exists vocabulario_revisiones (
  clave text primary key,
  producto text,
  receta text,
  etapa text,
  candidatos integer not null default 0,
  aprendidos integer not null default 0,
  created_at timestamptz not null default now()
);

alter table vocabulario_revisiones enable row level security;

drop policy if exists "allow all vocabulario_revisiones" on vocabulario_revisiones;
create policy "allow all vocabulario_revisiones" on vocabulario_revisiones
  for all using (true) with check (true);
