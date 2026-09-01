import { NextResponse } from 'next/server';
import { z } from 'zod';
import { getSupabaseAdmin } from '@/lib/supabase/admin';
import {
  ALLOWED_MIME_TYPES,
  DOCUMENTS_BUCKET,
  MAX_UPLOAD_SIZE_BYTES,
  storagePathFor,
} from '@/lib/documents/constants';

export async function GET() {
  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase
    .from('documents')
    .select('*')
    .order('created_at', { ascending: false });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ documents: data });
}

const initiateUploadSchema = z.object({
  filename: z.string().min(1).max(500),
  fileHash: z.string().regex(/^[a-f0-9]{64}$/, 'fileHash debe ser un sha256 hex'),
  mimeType: z.string(),
  sizeBytes: z.number().int().positive(),
});

export async function POST(request: Request) {
  const body = await request.json().catch(() => null);
  const parsed = initiateUploadSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }
  const { filename, fileHash, mimeType, sizeBytes } = parsed.data;

  if (!ALLOWED_MIME_TYPES.includes(mimeType as (typeof ALLOWED_MIME_TYPES)[number])) {
    return NextResponse.json(
      { error: `Tipo de archivo no soportado: ${mimeType}. Solo se admite PDF por ahora.` },
      { status: 415 },
    );
  }
  if (sizeBytes > MAX_UPLOAD_SIZE_BYTES) {
    return NextResponse.json(
      { error: `El archivo supera el límite de ${MAX_UPLOAD_SIZE_BYTES / (1024 * 1024)} MB.` },
      { status: 413 },
    );
  }

  const supabase = getSupabaseAdmin();

  // Deduplicación: si ya existe un documento con el mismo hash, no se
  // vuelve a subir ni a crear un registro nuevo.
  const { data: existing, error: existingError } = await supabase
    .from('documents')
    .select('*')
    .eq('file_hash', fileHash)
    .maybeSingle();

  if (existingError) {
    return NextResponse.json({ error: existingError.message }, { status: 500 });
  }
  if (existing) {
    return NextResponse.json({ duplicate: true, document: existing });
  }

  const title = filename.replace(/\.pdf$/i, '');

  const { data: document, error: insertError } = await supabase
    .from('documents')
    .insert({
      title,
      file_hash: fileHash,
      storage_path: '', // se completa tras generar el path con el id real
      mime_type: mimeType,
      file_size_bytes: sizeBytes,
      status: 'pending',
    })
    .select('*')
    .single();

  if (insertError || !document) {
    return NextResponse.json(
      { error: insertError?.message ?? 'No se pudo crear el documento' },
      { status: 500 },
    );
  }

  const path = storagePathFor(document.id);

  const { data: signed, error: signedError } = await supabase.storage
    .from(DOCUMENTS_BUCKET)
    .createSignedUploadUrl(path);

  if (signedError || !signed) {
    // revertir el registro creado si no se pudo generar la URL de subida
    await supabase.from('documents').delete().eq('id', document.id);
    return NextResponse.json(
      { error: signedError?.message ?? 'No se pudo generar la URL de subida' },
      { status: 500 },
    );
  }

  await supabase.from('documents').update({ storage_path: path }).eq('id', document.id);

  return NextResponse.json({
    duplicate: false,
    documentId: document.id,
    path: signed.path,
    token: signed.token,
  });
}
