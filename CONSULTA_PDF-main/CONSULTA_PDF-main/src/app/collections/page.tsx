import { getSupabaseAdmin } from '@/lib/supabase/admin';
import { CollectionsView } from '@/components/collections/CollectionsView';

export const dynamic = 'force-dynamic';

export default async function CollectionsPage() {
  const supabase = getSupabaseAdmin();
  const { data: collections, error } = await supabase
    .from('collections')
    .select('*')
    .order('created_at', { ascending: false });

  if (error) {
    return (
      <div className="flex flex-1 items-center justify-center p-6">
        <p className="text-red-600 dark:text-red-400">No se pudo conectar con Supabase: {error.message}</p>
      </div>
    );
  }

  const { data: links } = await supabase.from('collection_documents').select('collection_id');
  const counts = new Map<string, number>();
  for (const l of links ?? []) counts.set(l.collection_id, (counts.get(l.collection_id) ?? 0) + 1);

  return (
    <CollectionsView
      initialCollections={(collections ?? []).map((c) => ({ ...c, document_count: counts.get(c.id) ?? 0 }))}
    />
  );
}
