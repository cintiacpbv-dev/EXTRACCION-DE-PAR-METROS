-- Migración v8: memoria de lo eliminado
--
-- La aplicación sube a Supabase todo documento que exista en el navegador y
-- no en la nube, para no perder un análisis hecho sin conexión. Pero "está
-- en el navegador y no en la nube" es justo el aspecto de un documento que
-- se borró desde OTRA computadora: al abrir la aplicación, esa otra máquina
-- lo daba por trabajo pendiente y lo volvía a subir, resucitándolo para
-- todos.
--
-- Esta tabla deja constancia compartida de lo eliminado, para que ninguna
-- computadora vuelva a subir lo que otra ya borró.
--
-- Ejecutar UNA vez en: Supabase Dashboard -> SQL Editor -> New query -> Run

create table if not exists deleted_documents (
  clave text primary key,
  producto text,
  lote text,
  stage text,
  kind text,
  deleted_at timestamptz not null default now()
);

alter table deleted_documents enable row level security;

drop policy if exists "allow all deleted_documents" on deleted_documents;
create policy "allow all deleted_documents" on deleted_documents for all using (true) with check (true);
