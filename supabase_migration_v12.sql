-- Migración v12 — YA NO HACE FALTA CORRERLA.
--
-- Esta migración amplíaba la regla de "no repetido" de batch_personnel para
-- que compare también la columna "seccion". Se necesitaba porque la
-- aplicación guardaba dos filas por persona a propósito —una para el total
-- de la etapa y otra por cada operación en la que firmó— y esas dos filas
-- chocaban entre sí bajo la regla vieja, así que Postgres rechazaba el
-- guardado del personal entero.
--
-- Se corrigió por el otro lado: ahora la aplicación guarda como mucho una
-- fila por persona y rol, con todas sus secciones unidas en una sola
-- casilla. Ya no hay dos filas que puedan chocar, así que la regla vieja
-- —la que ya tiene tu base de datos— es suficiente y no hace falta tocarla.
--
-- Se deja este archivo sólo para que quien lo vea no se pregunte qué pasó
-- con la v12: no se saltó un número, es que resultó innecesaria.

select 1; -- nada que ejecutar
