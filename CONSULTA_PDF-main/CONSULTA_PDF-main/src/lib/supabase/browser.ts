import { createClient, type SupabaseClient } from '@supabase/supabase-js';

let client: SupabaseClient | null = null;

/**
 * Cliente Supabase para el navegador (clave anon, pública por diseño).
 * Solo se usa para subir archivos directamente a Storage mediante URLs
 * firmadas generadas por el servidor — nunca para leer/escribir la base
 * de datos directamente desde el cliente.
 *
 * IMPORTANTE: las variables NEXT_PUBLIC_* se "inlinean" en el bundle del
 * navegador solo cuando Next.js puede analizarlas de forma ESTÁTICA como
 * `process.env.NEXT_PUBLIC_X` literal -- un helper con acceso dinámico
 * (`process.env[name]`) rompe esa detección y siempre da undefined en el
 * navegador, sin importar que la variable exista en .env.local. Por eso
 * aquí se accede a cada una explícitamente, no vía una función genérica.
 */
export function getSupabaseBrowser() {
  if (!client) {
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
    if (!url) throw new Error('Falta la variable de entorno NEXT_PUBLIC_SUPABASE_URL');
    if (!anonKey) throw new Error('Falta la variable de entorno NEXT_PUBLIC_SUPABASE_ANON_KEY');

    client = createClient(url, anonKey, { auth: { persistSession: false } });
  }
  return client;
}
