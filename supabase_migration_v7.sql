-- Migración v7: imagen de cada producto
--
-- Sustituye al icono genérico en la biblioteca. Se guarda un PNG cuadrado de
-- 256 px como data URI (unas decenas de kB) para que la imagen siga
-- disponible aunque el sitio de origen desaparezca; cuando el servidor de
-- origen no permite convertirla, se guarda el enlace tal cual.
--
-- La clave es la familia de producto (el nombre más corto del grupo), que es
-- la unidad con la que trabaja toda la aplicación.
--
-- Ejecutar UNA vez en: Supabase Dashboard -> SQL Editor -> New query -> Run

create table if not exists product_images (
  familia text primary key,
  imagen text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

drop trigger if exists trg_product_images_updated_at on product_images;
create trigger trg_product_images_updated_at
  before update on product_images
  for each row execute function set_updated_at();

alter table product_images enable row level security;

drop policy if exists "allow all product_images" on product_images;
create policy "allow all product_images" on product_images for all using (true) with check (true);
