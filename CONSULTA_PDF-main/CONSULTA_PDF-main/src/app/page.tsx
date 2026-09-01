import { getSupabaseAdmin } from '@/lib/supabase/admin';
import { LibraryView } from '@/components/library/LibraryView';

// Sin esto, Next.js puede pre-renderizar esta página en build time y
// servir esa foto congelada de la biblioteca a todo el mundo en vez de
// consultar Supabase en cada visita -- confirmado con `next build`
// (marcaba "/" como estático ○).
export const dynamic = 'force-dynamic';

function ConfigError({ message }: { message: string }) {
  return (
    <div className="flex flex-1 items-center justify-center p-6">
      <p className="max-w-md text-center text-red-600 dark:text-red-400">{message}</p>
    </div>
  );
}

export default async function Home() {
  let supabase: ReturnType<typeof getSupabaseAdmin>;
  try {
    supabase = getSupabaseAdmin();
  } catch {
    return (
      <ConfigError message="Faltan las variables de entorno de Supabase. Copia .env.local.example a .env.local y complétalo con los datos de tu proyecto." />
    );
  }

  const { data: documents, error } = await supabase
    .from('documents')
    .select('*')
    .order('created_at', { ascending: false });

  if (error) {
    return <ConfigError message={`No se pudo conectar con Supabase: ${error.message}`} />;
  }

  return <LibraryView initialDocuments={documents ?? []} />;
}
