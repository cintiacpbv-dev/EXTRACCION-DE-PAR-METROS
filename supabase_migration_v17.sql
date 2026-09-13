-- Migración v17: guardar también POR QUÉ se aprendió cada magnitud
--
-- La v16 guarda de qué producto, receta, etapa y etiqueta salió cada término,
-- pero no el argumento con el que la IA dijo que era un parámetro de proceso.
-- El panel lo enseñaba —se recibe junto con el término— y se perdía al
-- recargar, porque no había dónde ponerlo.
--
-- La etiqueta dice de dónde salió; el motivo dice con qué argumento. Las dos
-- mitades hacen falta para poder revisar un término y decidir si se queda.
--
-- Ejecutar UNA vez en: Supabase Dashboard -> SQL Editor -> New query -> Run

alter table vocabulario_parametros add column if not exists motivo text;
