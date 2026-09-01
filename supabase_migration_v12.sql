-- Migración v12: la misma persona puede aparecer dos veces por lote y etapa
--
-- La migración v11 añadió la columna "seccion" para guardar, además del
-- total de la etapa, quién firmó dentro de cada operación (lotizado,
-- acondicionado). Pero no tocó la regla que dice qué fila no puede repetirse
-- —"no puede haber dos filas con el mismo batch_id, stage, role y name"—, y
-- esa regla no incluye "seccion".
--
-- Eso rompe justo el caso para el que se creó la columna: la misma persona
-- entra dos veces a propósito, una como el total de la etapa (seccion en
-- blanco) y otra bajo la operación en la que firmó (seccion con nombre).
-- Para la base de datos esas dos filas son "la misma" —mismo lote, misma
-- etapa, mismo rol, mismo nombre— y la segunda choca contra la primera.
-- Postgres rechaza el grupo entero de filas que se intentan guardar juntas,
-- así que ese lote se queda sin ningún nombre en el cuadro de personal, no
-- sólo sin el reparto por operación.
--
-- Se corrige ampliando la regla para que compare también "seccion": el
-- total y el detalle de cada persona ya no se confunden entre sí.
--
-- Ejecutar UNA vez en: Supabase Dashboard -> SQL Editor -> New query -> Run

alter table batch_personnel
  drop constraint if exists batch_personnel_batch_id_stage_role_name_key;

alter table batch_personnel
  add constraint batch_personnel_batch_id_stage_role_name_seccion_key
  unique (batch_id, stage, role, name, seccion);
