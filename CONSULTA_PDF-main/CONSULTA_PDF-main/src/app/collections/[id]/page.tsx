import { notFound } from 'next/navigation';
import { getSupabaseAdmin } from '@/lib/supabase/admin';
import { CollectionDetailView } from '@/components/collections/CollectionDetailView';
import type { DocumentRow } from '@/types/database';

export const dynamic = 'force-dynamic';

export default async function CollectionDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const supabase = getSupabaseAdmin();

  const { data: collection, error } = await supabase
    .from('collections')
    .select('*')
    .eq('id', id)
    .maybeSingle();
  if (error) {
    return (
      <div className="flex flex-1 items-center justify-center p-6">
        <p className="text-red-600 dark:text-red-400">No se pudo conectar con Supabase: {error.message}</p>
      </div>
    );
  }
  if (!collection) notFound();

  const { data: links } = await supabase
    .from('collection_documents')
    .select('documents(*)')
    .eq('collection_id', id);
  // PostgREST devuelve el recurso embebido como objeto único (relación
  // to-one), pero sin tipos generados supabase-js lo infiere de forma
  // demasiado genérica -- se castea explícitamente.
  const documents = (links ?? [])
    .map((l) => l.documents as unknown as DocumentRow)
    .filter(Boolean);

  const { data: allDocuments } = await supabase
    .from('documents')
    .select('*')
    .eq('status', 'ready')
    .order('title', { ascending: true });

  return (
    <CollectionDetailView
      collection={collection}
      initialDocuments={documents}
      allDocuments={allDocuments ?? []}
    />
  );
}
