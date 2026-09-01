import { NextResponse } from 'next/server';
import { getSupabaseAdmin } from '@/lib/supabase/admin';

/**
 * El cliente llama a este endpoint después de subir el archivo con éxito
 * a la URL firmada. Encola el job de ingesta (aún sin worker real —
 * eso llega en la Fase 4) y deja el documento listo para ser procesado.
 */
export async function POST(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const supabase = getSupabaseAdmin();

  const { data: document, error: fetchError } = await supabase
    .from('documents')
    .select('id, status')
    .eq('id', id)
    .maybeSingle();

  if (fetchError) {
    return NextResponse.json({ error: fetchError.message }, { status: 500 });
  }
  if (!document) {
    return NextResponse.json({ error: 'Documento no encontrado' }, { status: 404 });
  }

  const { error: jobError } = await supabase
    .from('processing_jobs')
    .insert({ document_id: id, status: 'queued' });

  if (jobError) {
    return NextResponse.json({ error: jobError.message }, { status: 500 });
  }

  return NextResponse.json({ success: true });
}
