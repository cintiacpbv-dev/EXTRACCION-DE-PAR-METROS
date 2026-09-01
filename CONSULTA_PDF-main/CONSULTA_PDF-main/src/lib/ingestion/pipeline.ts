import { getSupabaseAdmin } from '@/lib/supabase/admin';
import { DOCUMENTS_BUCKET, COVERS_BUCKET, coverPathFor } from '@/lib/documents/constants';
import { openPdf, extractPageText, hasSufficientNativeText } from './pdf-reader';
import { transcribePagesRobust } from './vision';
import { chunkPages, type PageForChunking } from './chunking';
import { stripBoilerplate } from './boilerplate';
import { embedTexts } from './embeddings';
import { renderCoverImage } from './cover';
import type { DocumentPageRow, ProcessingJobRow } from '@/types/database';

const PAGE_BATCH_SIZE = 15;
const VISION_SUBBATCH_SIZE = 8;
// 40 chunks reales (hasta ~900 tokens cada uno) pueden sumar decenas de
// miles de tokens en una sola llamada y superar el límite de
// tokens-por-minuto del nivel gratuito de Gemini -- confirmado en uso
// real con un documento de 208 páginas. Un lote más chico da margen.
const EMBED_BATCH_SIZE = 10;
const MAX_RETRIES = 3;

export type TickResult =
  | { processed: false }
  | { processed: true; documentId: string; stage: string; done: boolean; error?: string };

async function downloadPdfBytes(storagePath: string): Promise<Uint8Array> {
  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase.storage.from(DOCUMENTS_BUCKET).download(storagePath);
  if (error || !data) {
    throw new Error(`No se pudo descargar el archivo original: ${error?.message}`);
  }
  const buffer = await data.arrayBuffer();
  return new Uint8Array(buffer);
}

/**
 * Procesa UN lote de trabajo de UN job de la cola y devuelve. Diseñado
 * para ejecutarse repetidamente (desde `POST /api/worker/tick` o desde el
 * script de worker local) hasta que el documento quede `ready`. Cada
 * llamada hace una cantidad de trabajo acotada (unos segundos), nunca
 * procesa el documento entero de una sola vez.
 */
export async function processNextJobBatch(): Promise<TickResult> {
  const supabase = getSupabaseAdmin();

  const { data: jobs, error: jobsError } = await supabase
    .from('processing_jobs')
    .select('*')
    .in('status', ['queued', 'processing'])
    .order('created_at', { ascending: true })
    .limit(1);

  if (jobsError) throw new Error(jobsError.message);
  const job = jobs?.[0] as ProcessingJobRow | undefined;
  if (!job) return { processed: false };

  if (job.status === 'queued') {
    await supabase
      .from('processing_jobs')
      .update({ status: 'processing', current_stage: job.current_stage ?? 'starting' })
      .eq('id', job.id);
  }

  try {
    const stage = job.current_stage ?? 'starting';
    const done = await runStage(job, stage);
    return { processed: true, documentId: job.document_id, stage, done };
  } catch (err) {
    await handleJobError(job, err);
    const message = err instanceof Error ? err.message : String(err);
    return {
      processed: true,
      documentId: job.document_id,
      stage: job.current_stage ?? 'starting',
      done: false,
      error: message,
    };
  }
}

const GENEROUS_MAX_RETRIES = MAX_RETRIES * 20;

/**
 * Errores donde reintentar NUNCA va a ayudar -- fallan rápido (3
 * intentos) en vez de agotar 60 reintentos inútilmente. Todo lo demás
 * (incluyendo tipos de error que todavía no hemos visto) se trata como
 * potencialmente transitorio y se reintenta generosamente por defecto:
 * la mayoría de los fallos reales que hemos visto en producción (cuota
 * de Gemini agotada, "RECITATION", carreras de escritura concurrente)
 * resultaron ser recuperables con suficientes reintentos, no errores
 * permanentes del pipeline.
 */
function isPermanentError(message: string): boolean {
  return (
    message.includes('Object not found') || // archivo original borrado del Storage
    message.includes('Documento no encontrado') || // fila de documents borrada a mitad de proceso
    message.includes('Falta la variable de entorno') // config del servidor, no se arregla reintentando
  );
}

async function handleJobError(job: ProcessingJobRow, err: unknown) {
  const supabase = getSupabaseAdmin();
  const message = err instanceof Error ? err.message : String(err);
  const retryCount = job.retry_count + 1;

  const effectiveMaxRetries = isPermanentError(message) ? MAX_RETRIES : GENEROUS_MAX_RETRIES;

  if (retryCount >= effectiveMaxRetries) {
    await supabase
      .from('processing_jobs')
      .update({ status: 'failed', retry_count: retryCount, error_message: message })
      .eq('id', job.id);
    await supabase
      .from('documents')
      .update({ status: 'error', processing_error: message })
      .eq('id', job.document_id);
  } else {
    await supabase
      .from('processing_jobs')
      .update({ status: 'processing', retry_count: retryCount, error_message: message })
      .eq('id', job.id);
  }
}

async function runStage(job: ProcessingJobRow, stage: string): Promise<boolean> {
  switch (stage) {
    case 'starting':
      return runStarting(job);
    case 'extracting_pages':
      return runExtractingPages(job);
    case 'chunking':
      return runChunking(job);
    case 'embedding':
      return runEmbedding(job);
    default:
      throw new Error(`Etapa de procesamiento desconocida: ${stage}`);
  }
}

async function runStarting(job: ProcessingJobRow): Promise<boolean> {
  const supabase = getSupabaseAdmin();
  const { data: document, error } = await supabase
    .from('documents')
    .select('storage_path, title')
    .eq('id', job.document_id)
    .single();
  if (error || !document) throw new Error(error?.message ?? 'Documento no encontrado');

  const bytes = await downloadPdfBytes(document.storage_path);
  const pdf = await openPdf(bytes);
  const pageCount = pdf.numPages;

  // La carátula es un extra visual, no crítico: si falla no debe tumbar
  // el pipeline -- el documento simplemente se muestra con el ícono
  // genérico en vez de una miniatura de la portada.
  const cover = await renderCoverImage(bytes, document.title);
  if (cover) {
    await supabase.storage
      .from(COVERS_BUCKET)
      .upload(coverPathFor(job.document_id), cover, { contentType: 'image/png', upsert: true });
  }

  await supabase
    .from('documents')
    .update({ status: 'processing', page_count: pageCount, processing_progress: 1 })
    .eq('id', job.document_id);

  await supabase
    .from('processing_jobs')
    .update({ current_stage: 'extracting_pages', last_page_processed: 0 })
    .eq('id', job.id);

  return false;
}

async function runExtractingPages(job: ProcessingJobRow): Promise<boolean> {
  const supabase = getSupabaseAdmin();
  const { data: document, error } = await supabase
    .from('documents')
    .select('storage_path, page_count')
    .eq('id', job.document_id)
    .single();
  if (error || !document?.page_count) {
    throw new Error(error?.message ?? 'El documento no tiene page_count establecido');
  }

  const bytes = await downloadPdfBytes(document.storage_path);
  const pdf = await openPdf(bytes);

  const batchStart = job.last_page_processed + 1;
  const batchEnd = Math.min(job.last_page_processed + PAGE_BATCH_SIZE, document.page_count);

  const nativeResults: { pageNumber: number; text: string }[] = [];
  const needsVision: number[] = [];

  for (let pageNumber = batchStart; pageNumber <= batchEnd; pageNumber++) {
    const text = await extractPageText(pdf, pageNumber);
    if (hasSufficientNativeText(text)) {
      nativeResults.push({ pageNumber, text });
    } else {
      needsVision.push(pageNumber);
    }
  }

  const rowsToUpsert: Partial<DocumentPageRow>[] = nativeResults.map((r) => ({
    document_id: job.document_id,
    page_number: r.pageNumber,
    has_native_text: true,
    processing_method: 'text_extraction',
    raw_text: r.text,
    content_type_hint: null,
  }));

  for (let i = 0; i < needsVision.length; i += VISION_SUBBATCH_SIZE) {
    const subBatch = needsVision.slice(i, i + VISION_SUBBATCH_SIZE);
    const visionResults = await transcribePagesRobust(bytes, subBatch);
    for (const r of visionResults) {
      rowsToUpsert.push({
        document_id: job.document_id,
        page_number: r.pageNumber,
        has_native_text: false,
        processing_method: 'vision',
        raw_text: r.text,
        content_type_hint: r.contentType,
      });
    }
  }

  // Gemini a veces devuelve una página duplicada en la transcripción por
  // visión (p.ej. dos entradas con el mismo page_number). Postgres no
  // permite que un upsert afecte la misma fila dos veces en el mismo
  // batch ("ON CONFLICT DO UPDATE command cannot affect row a second
  // time"), así que se deduplica antes de enviar -- se queda con la
  // última ocurrencia.
  const dedupedRows = [...new Map(rowsToUpsert.map((r) => [r.page_number, r])).values()];

  if (dedupedRows.length > 0) {
    const { error: upsertError } = await supabase
      .from('document_pages')
      .upsert(dedupedRows, { onConflict: 'document_id,page_number' });
    if (upsertError) throw new Error(upsertError.message);
  }

  const progress = Math.round((batchEnd / document.page_count) * 70);
  const finishedExtraction = batchEnd >= document.page_count;

  await supabase
    .from('processing_jobs')
    .update({
      last_page_processed: batchEnd,
      current_stage: finishedExtraction ? 'chunking' : 'extracting_pages',
    })
    .eq('id', job.id);

  await supabase.from('documents').update({ processing_progress: progress }).eq('id', job.document_id);

  return false;
}

async function runChunking(job: ProcessingJobRow): Promise<boolean> {
  const supabase = getSupabaseAdmin();
  const { data: pages, error } = await supabase
    .from('document_pages')
    .select('page_number, raw_text, content_type_hint')
    .eq('document_id', job.document_id)
    .order('page_number', { ascending: true });
  if (error) throw new Error(error.message);

  const pagesForChunking: PageForChunking[] = (pages ?? []).map((p) => ({
    pageNumber: p.page_number,
    text: p.raw_text ?? '',
    contentTypeHint: p.content_type_hint ?? undefined,
  }));

  // Elimina marcas de agua / licencias / encabezados-pies de página
  // repetidos antes de fragmentar -- si no, cada chunk arrastra ese ruido.
  const cleanedPages = stripBoilerplate(pagesForChunking);

  const chunks = chunkPages(cleanedPages);

  if (chunks.length > 0) {
    const rows = chunks.map((c) => ({
      document_id: job.document_id,
      page_start: c.pageStart,
      page_end: c.pageEnd,
      chapter: c.chapter,
      section: c.section,
      content_type: c.contentType,
      position: c.position,
      content: c.content,
      content_hash: c.contentHash,
      token_count: c.tokenCount,
    }));
    // Párrafos idénticos repetidos en el documento (encabezados, pies de
    // página) pueden generar el mismo content_hash -- mismo problema de
    // upsert que en document_pages, se deduplica antes de enviar.
    const dedupedRows = [...new Map(rows.map((r) => [r.content_hash, r])).values()];
    const { error: insertError } = await supabase
      .from('document_chunks')
      .upsert(dedupedRows, { onConflict: 'document_id,content_hash' });
    if (insertError) throw new Error(insertError.message);
  }

  await supabase
    .from('processing_jobs')
    .update({ current_stage: 'embedding', last_page_processed: 0 })
    .eq('id', job.id);

  await supabase.from('documents').update({ processing_progress: 75 }).eq('id', job.document_id);

  return false;
}

async function runEmbedding(job: ProcessingJobRow): Promise<boolean> {
  const supabase = getSupabaseAdmin();

  const { data: chunks, error } = await supabase
    .from('document_chunks')
    .select('id, content')
    .eq('document_id', job.document_id)
    .order('position', { ascending: true });
  if (error) throw new Error(error.message);

  // Filtrado por document_id, NUNCA por una lista de chunk_id: con
  // documentos grandes (p.ej. 945 páginas -> 1000 chunks) un
  // `.in('chunk_id', [...1000 ids...])` supera el límite de longitud de
  // query de PostgREST y responde 400 Bad Request -- bug real
  // encontrado en producción, ver migración 20260821000000.
  const { data: embedded, error: embeddedError } = await supabase
    .from('document_embeddings')
    .select('chunk_id')
    .eq('document_id', job.document_id);
  if (embeddedError) throw new Error(embeddedError.message);

  const embeddedIds = new Set((embedded ?? []).map((e) => e.chunk_id));
  const pending = (chunks ?? []).filter((c) => !embeddedIds.has(c.id));

  if (pending.length === 0) {
    await finalizeDocument(job);
    return true;
  }

  const batch = pending.slice(0, EMBED_BATCH_SIZE);
  const vectors = await embedTexts(
    batch.map((c) => c.content),
    'RETRIEVAL_DOCUMENT',
  );

  const rows = batch.map((c, i) => ({
    chunk_id: c.id,
    document_id: job.document_id,
    embedding: vectors[i],
    model_version: 'gemini-embedding-001',
  }));
  // upsert, no insert: si dos ticks concurrentes (p.ej. dos pestañas, o
  // el worker script + la UI a la vez) procesan el mismo lote de chunks
  // pendientes, un insert plano falla con "duplicate key value violates
  // unique constraint" en el segundo -- con upsert simplemente sobrescribe
  // con el mismo embedding (mismo contenido, mismo resultado) sin error.
  const { error: insertError } = await supabase
    .from('document_embeddings')
    .upsert(rows, { onConflict: 'chunk_id' });
  if (insertError) throw new Error(insertError.message);

  const totalDone = embeddedIds.size + batch.length;
  const totalChunks = chunks?.length ?? 1;
  const progress = 75 + Math.round((totalDone / totalChunks) * 25);
  await supabase.from('documents').update({ processing_progress: Math.min(progress, 99) }).eq('id', job.document_id);

  if (totalDone >= totalChunks) {
    await finalizeDocument(job);
    return true;
  }

  return false;
}

async function finalizeDocument(job: ProcessingJobRow) {
  const supabase = getSupabaseAdmin();
  await supabase
    .from('documents')
    .update({ status: 'ready', processing_progress: 100 })
    .eq('id', job.document_id);
  await supabase
    .from('processing_jobs')
    .update({ status: 'completed', current_stage: 'done' })
    .eq('id', job.id);
}
