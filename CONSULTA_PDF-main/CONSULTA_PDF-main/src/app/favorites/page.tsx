import { getSupabaseAdmin } from '@/lib/supabase/admin';
import { LibraryView } from '@/components/library/LibraryView';

export const dynamic = 'force-dynamic';

export default async function FavoritesPage() {
  const supabase = getSupabaseAdmin();
  const { data: documents, error } = await supabase
    .from('documents')
    .select('*')
    .eq('is_favorite', true)
    .order('created_at', { ascending: false });

  if (error) {
    return (
      <div className="flex flex-1 items-center justify-center p-6">
        <p className="text-red-600 dark:text-red-400">No se pudo conectar con Supabase: {error.message}</p>
      </div>
    );
  }

  return (
    <LibraryView
      initialDocuments={documents ?? []}
      title="Favoritos"
      emptyMessage="Todavía no marcaste ningún documento como favorito."
      emptyHint="Toca la estrella en cualquier documento de tu biblioteca para verlo aquí."
      favoritesOnly
      showUpload={false}
    />
  );
}
