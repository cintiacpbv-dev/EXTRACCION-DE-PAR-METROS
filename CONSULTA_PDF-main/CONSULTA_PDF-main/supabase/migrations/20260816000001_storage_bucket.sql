-- Bucket privado para los documentos originales.
-- Sin políticas públicas: todo acceso pasa por el backend (service role)
-- o por URLs firmadas de corta duración generadas por el servidor.

insert into storage.buckets (id, name, public)
values ('documents', 'documents', false)
on conflict (id) do nothing;
