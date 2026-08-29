-- Migración v11: en qué sección del registro firmó cada persona
--
-- El informe de acondicionado lista el personal separado por operación: quién
-- imprimió las cajas (el "lotizado", OPERACION N° 1) y quién acondicionó
-- (OPERACION N° 2). Son trabajos distintos, con distinta gente y a menudo con
-- días de por medio, así que no basta con el total de la etapa.
--
-- La columna es opcional: sin ella la aplicación sigue guardando el personal
-- como hasta ahora, sólo que sin poder separarlo por operación.
--
-- Ejecutar UNA vez en: Supabase Dashboard -> SQL Editor -> New query -> Run

alter table batch_personnel add column if not exists seccion text;
