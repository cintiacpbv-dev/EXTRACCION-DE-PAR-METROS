import { NextResponse } from 'next/server';
import { getSupabaseAdmin } from '@/lib/supabase/admin';

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const supabase = getSupabaseAdmin();

  const { data: collection, error } = await supabase
    .from('collections')
    .select('*')
    .eq('id', id)
    .maybeSingle();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (!collection) return NextResponse.json({ error: 'Colección no encontrada' }, { status: 404 });

  const { data: links, error: linksError } = await supabase
    .from('collection_documents')
    .select('document_id, documents(*)')
    .eq('collection_id', id);
  if (linksError) return NextResponse.json({ error: linksError.message }, { status: 500 });

  return NextResponse.json({
    collection,
    documents: (links ?? []).map((l) => l.documents).filter(Boolean),
  });
}

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const supabase = getSupabaseAdmin();
  const { error } = await supabase.from('collections').delete().eq('id', id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ success: true });
}
