import { NextResponse } from 'next/server';
import { getSupabaseAdmin } from '@/lib/supabase/admin';

/**
 * Reactiva un documento que quedó en estado 'error' (reintentos
 * automáticos agotados): resetea el job existente en vez de crear uno
 * nuevo, así retoma desde la última etapa/página alcanzada en vez de
 * volver a empezar desde cero.
 */
export async function POST(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const supabase = getSupabaseAdmin();

  const { data: job, error: jobError } = await supabase
    .from('processing_jobs')
    .select('id')
    .eq('document_id', id)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (jobError) return NextResponse.json({ error: jobError.message }, { status: 500 });
  if (!job) return NextResponse.json({ error: 'No hay ningún job de procesamiento para este documento' }, { status: 404 });

  await supabase
    .from('processing_jobs')
    .update({ status: 'queued', retry_count: 0, error_message: null })
    .eq('id', job.id);
  await supabase
    .from('documents')
    .update({ status: 'processing', processing_error: null })
    .eq('id', id);

  return NextResponse.json({ success: true });
}
