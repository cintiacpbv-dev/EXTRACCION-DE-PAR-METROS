import { NextResponse } from 'next/server';
import { getSupabaseAdmin } from '@/lib/supabase/admin';
import { DOCUMENTS_BUCKET } from '@/lib/documents/constants';

const SIGNED_URL_TTL_SECONDS = 300;

/**
 * Genera una URL firmada de corta duración para visualizar el PDF
 * original. El bucket es privado -- nunca se expone una URL pública fija.
 */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const supabase = getSupabaseAdmin();

  const { data: document, error } = await supabase
    .from('documents')
    .select('storage_path')
    .eq('id', id)
    .maybeSingle();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (!document) return NextResponse.json({ error: 'Documento no encontrado' }, { status: 404 });

  const { data: signed, error: signError } = await supabase.storage
    .from(DOCUMENTS_BUCKET)
    .createSignedUrl(document.storage_path, SIGNED_URL_TTL_SECONDS);
  if (signError || !signed) {
    return NextResponse.json({ error: signError?.message ?? 'No se pudo firmar la URL' }, { status: 500 });
  }

  return NextResponse.json({ url: signed.signedUrl });
}
