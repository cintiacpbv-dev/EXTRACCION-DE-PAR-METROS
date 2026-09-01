import 'server-only';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Falta la variable de entorno ${name}`);
  }
  return value;
}

let client: SupabaseClient | null = null;

/**
 * Cliente Supabase con service role. Server-only: acceso total a la base
 * de datos y al Storage privado. No hay RLS multiusuario en este proyecto
 * (uso personal, sin autenticación) por lo que TODO el acceso a datos debe
 * pasar por rutas de servidor que usan este cliente — nunca exponer la
 * service role key al navegador.
 *
 * Nota: sin genérico `Database` a propósito — el tipado manual de ese
 * genérico no encajaba con los tipos internos de supabase-js sin
 * introspección real del esquema. Los resultados se tipan explícitamente
 * en cada call site con las interfaces de `@/types/database`. Cuando el
 * proyecto esté enlazado a Supabase, generar tipos reales con
 * `supabase gen types typescript` y volver a introducir el genérico.
 */
export function getSupabaseAdmin() {
  if (!client) {
    client = createClient(
      requireEnv('NEXT_PUBLIC_SUPABASE_URL'),
      requireEnv('SUPABASE_SERVICE_ROLE_KEY'),
      { auth: { persistSession: false } },
    );
  }
  return client;
}
