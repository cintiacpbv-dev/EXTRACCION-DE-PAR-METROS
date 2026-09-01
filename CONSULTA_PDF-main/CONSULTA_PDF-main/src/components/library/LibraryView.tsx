'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Upload, Search } from 'lucide-react';
import type { DocumentRow } from '@/types/database';
import { getSupabaseBrowser } from '@/lib/supabase/browser';
import { sha256Hex } from '@/lib/utils/format';
import { DOCUMENTS_BUCKET, MAX_UPLOAD_SIZE_BYTES } from '@/lib/documents/constants';
import { DocumentCard } from './DocumentCard';

type UploadState = { fileName: string; stage: string } | null;

const TICK_INTERVAL_MS = 2500;

export function LibraryView({
  initialDocuments,
  title = 'Biblioteca',
  emptyMessage = 'Tu biblioteca está vacía.',
  emptyHint = 'Sube un PDF para empezar a construir tu base de conocimiento.',
  favoritesOnly = false,
  showUpload = true,
}: {
  initialDocuments: DocumentRow[];
  title?: string;
  emptyMessage?: string;
  emptyHint?: string;
  favoritesOnly?: boolean;
  showUpload?: boolean;
}) {
  const router = useRouter();
  const [documents, setDocuments] = useState(initialDocuments);
  const [upload, setUpload] = useState<UploadState>(null);
  const [error, setError] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);
  const tickingRef = useRef(false);

  function handleLibrarySearch(e: React.FormEvent) {
    e.preventDefault();
    const trimmed = searchQuery.trim();
    if (!trimmed) return;
    // Sin documentId en la URL -> ChatView interpreta que la consulta es
    // contra toda la biblioteca. Para preguntar sobre un documento en
    // concreto, el usuario usa el botón "Preguntar sobre este documento"
    // de esa tarjeta, que sí manda el documentId.
    router.push(`/chat?q=${encodeURIComponent(trimmed)}`);
  }

  const refresh = useCallback(async () => {
    const res = await fetch('/api/documents');
    const body = await res.json();
    if (res.ok) setDocuments(body.documents);
  }, []);

  const hasActiveWork = documents.some((d) => d.status === 'pending' || d.status === 'processing');

  // Mientras haya documentos pendientes/procesando, va avanzando el
  // pipeline con ticks periódicos y refresca el estado. Se detiene solo
  // cuando ningún documento necesita trabajo.
  useEffect(() => {
    if (!hasActiveWork) return;
    let cancelled = false;

    const runTick = async () => {
      if (tickingRef.current || cancelled) return;
      tickingRef.current = true;
      try {
        await fetch('/api/worker/tick', { method: 'POST' });
        if (!cancelled) await refresh();
      } catch {
        // se reintenta en el siguiente intervalo
      } finally {
        tickingRef.current = false;
      }
    };

    runTick();
    const interval = setInterval(runTick, TICK_INTERVAL_MS);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [hasActiveWork, refresh]);

  async function handleFileSelected(file: File) {
    setError(null);

    if (file.type !== 'application/pdf') {
      setError('Solo se admiten archivos PDF por ahora.');
      return;
    }
    if (file.size > MAX_UPLOAD_SIZE_BYTES) {
      setError(`El archivo supera el límite de ${MAX_UPLOAD_SIZE_BYTES / (1024 * 1024)} MB.`);
      return;
    }

    // Si falla algo DESPUÉS de crear el registro del documento, hay que
    // borrarlo -- si no, queda un documento "pending" huérfano sin
    // archivo real y sin job, atascado para siempre.
    let createdDocumentId: string | undefined;

    try {
      setUpload({ fileName: file.name, stage: 'Calculando huella del archivo…' });
      const fileHash = await sha256Hex(file);

      setUpload({ fileName: file.name, stage: 'Preparando subida…' });
      const initRes = await fetch('/api/documents', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          filename: file.name,
          fileHash,
          mimeType: file.type,
          sizeBytes: file.size,
        }),
      });
      const initBody = await initRes.json();
      if (!initRes.ok) throw new Error(initBody.error ?? 'No se pudo iniciar la subida');

      if (initBody.duplicate) {
        setUpload(null);
        setError(`"${file.name}" ya está en tu biblioteca — no se ha vuelto a subir.`);
        await refresh();
        return;
      }

      createdDocumentId = initBody.documentId;

      setUpload({ fileName: file.name, stage: 'Subiendo a Storage…' });
      const supabase = getSupabaseBrowser();
      const { error: uploadError } = await supabase.storage
        .from(DOCUMENTS_BUCKET)
        .uploadToSignedUrl(initBody.path, initBody.token, file);
      if (uploadError) throw uploadError;

      setUpload({ fileName: file.name, stage: 'Confirmando…' });
      const completeRes = await fetch(`/api/documents/${initBody.documentId}/complete`, { method: 'POST' });
      if (!completeRes.ok) {
        const body = await completeRes.json().catch(() => ({}));
        throw new Error(body.error ?? 'No se pudo confirmar la subida ni encolar el procesamiento');
      }

      setUpload(null);
      await refresh();
    } catch (err) {
      setUpload(null);
      setError(err instanceof Error ? err.message : 'Error subiendo el archivo');
      if (createdDocumentId) {
        await fetch(`/api/documents/${createdDocumentId}`, { method: 'DELETE' }).catch(() => {});
        await refresh();
      }
    }
  }

  async function handleDelete(id: string) {
    const previous = documents;
    setDocuments((docs) => docs.filter((d) => d.id !== id));
    const res = await fetch(`/api/documents/${id}`, { method: 'DELETE' });
    if (!res.ok) {
      setDocuments(previous);
      const body = await res.json().catch(() => ({}));
      setError(body.error ?? 'No se pudo eliminar el documento');
    }
  }

  async function handleToggleFavorite(id: string, next: boolean) {
    const previous = documents;
    setDocuments((docs) =>
      favoritesOnly && !next
        ? docs.filter((d) => d.id !== id)
        : docs.map((d) => (d.id === id ? { ...d, is_favorite: next } : d)),
    );
    const res = await fetch(`/api/documents/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ is_favorite: next }),
    });
    if (!res.ok) {
      setDocuments(previous);
      setError('No se pudo actualizar favoritos');
    }
  }

  async function handleRename(id: string, title: string) {
    const previous = documents;
    setDocuments((docs) => docs.map((d) => (d.id === id ? { ...d, title } : d)));
    const res = await fetch(`/api/documents/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title }),
    });
    if (!res.ok) {
      setDocuments(previous);
      setError('No se pudo renombrar el documento');
    }
  }

  async function handleRetry(id: string) {
    setError(null);
    setDocuments((docs) =>
      docs.map((d) => (d.id === id ? { ...d, status: 'processing', processing_error: null } : d)),
    );
    const res = await fetch(`/api/documents/${id}/retry`, { method: 'POST' });
    if (!res.ok) {
      setError('No se pudo reiniciar el procesamiento');
    }
    await refresh();
  }

  const visibleDocuments = favoritesOnly ? documents.filter((d) => d.is_favorite) : documents;

  return (
    <div className="flex flex-1 flex-col gap-5 p-4 sm:gap-6 sm:p-6">
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0">
          <h1 className="text-xl font-semibold text-stone-900 dark:text-stone-50">{title}</h1>
          <p className="text-sm text-stone-500 dark:text-stone-400">
            {visibleDocuments.length} documento{visibleDocuments.length === 1 ? '' : 's'}
          </p>
        </div>
        {showUpload && (
          <>
            <button
              type="button"
              onClick={() => inputRef.current?.click()}
              disabled={upload !== null}
              className="flex items-center gap-2 rounded-lg bg-orange-600 px-4 py-2 text-sm font-medium text-white hover:bg-orange-700 disabled:opacity-50"
            >
              <Upload size={15} />
              Subir PDF
            </button>
            <input
              ref={inputRef}
              type="file"
              accept="application/pdf"
              className="hidden"
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) handleFileSelected(file);
                e.target.value = '';
              }}
            />
          </>
        )}
      </div>

      <form onSubmit={handleLibrarySearch} className="flex gap-2">
        <div className="relative flex-1">
          <Search
            size={18}
            className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-stone-400 sm:left-4"
          />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Pregunta algo sobre tu biblioteca…"
            className="w-full rounded-full border border-stone-300 bg-white py-3 pl-10 pr-3 text-base text-stone-900 outline-none focus:border-orange-500 dark:border-stone-700 dark:bg-stone-900 dark:text-stone-50 sm:py-3.5 sm:pl-11 sm:pr-4"
          />
        </div>
        <button
          type="submit"
          disabled={!searchQuery.trim()}
          className="flex shrink-0 items-center justify-center rounded-full bg-orange-600 p-3 text-white hover:bg-orange-700 disabled:opacity-50 sm:px-6 sm:py-3.5"
          aria-label="Preguntar"
        >
          <Search size={18} className="sm:hidden" />
          <span className="hidden text-sm font-medium sm:inline">Preguntar</span>
        </button>
      </form>

      {upload && (
        <div className="rounded-lg border border-stone-200 bg-stone-50 px-4 py-3 text-sm text-stone-700 dark:border-stone-800 dark:bg-stone-900 dark:text-stone-300">
          <span className="font-medium">{upload.fileName}</span> — {upload.stage}
        </div>
      )}

      {error && (
        <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 dark:border-red-500/20 dark:bg-red-500/10 dark:text-red-400">
          {error}
        </div>
      )}

      {visibleDocuments.length === 0 ? (
        <div className="flex flex-1 flex-col items-center justify-center gap-2 rounded-xl border border-dashed border-stone-300 py-24 text-center dark:border-stone-700">
          <p className="text-stone-500 dark:text-stone-400">{emptyMessage}</p>
          <p className="text-sm text-stone-400 dark:text-stone-500">{emptyHint}</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {visibleDocuments.map((doc) => (
            <DocumentCard
              key={doc.id}
              document={doc}
              onDelete={handleDelete}
              onToggleFavorite={handleToggleFavorite}
              onRename={handleRename}
              onRetry={handleRetry}
            />
          ))}
        </div>
      )}
    </div>
  );
}
