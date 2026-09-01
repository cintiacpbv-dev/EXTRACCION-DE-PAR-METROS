import { NextResponse } from 'next/server';
import { processNextJobBatch } from '@/lib/ingestion/pipeline';

/**
 * Avanza un lote pequeño de trabajo de ingesta (unos segundos) y devuelve.
 * Se llama repetidamente -- desde la UI mientras hay documentos en
 * procesamiento, o desde `npm run worker` -- hasta que no queden jobs.
 */
export async function POST() {
  try {
    const result = await processNextJobBatch();
    return NextResponse.json(result);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
