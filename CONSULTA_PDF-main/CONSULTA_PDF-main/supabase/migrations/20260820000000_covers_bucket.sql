-- Bucket público solo para miniaturas de carátula (primera página
-- renderizada como imagen). Baja sensibilidad -- es solo una miniatura de
-- la portada, no el documento completo -- así que va en un bucket público
-- separado del bucket privado "documents", evitando tener que generar
-- una URL firmada por cada tarjeta de la biblioteca.

insert into storage.buckets (id, name, public)
values ('covers', 'covers', true)
on conflict (id) do nothing;
