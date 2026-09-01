'use client';

import { useEffect, useState } from 'react';
import { X } from 'lucide-react';

interface PdfViewerModalProps {
  documentId: string;
  documentTitle: string;
  page: number;
  onClose: () => void;
}

/**
 * Visor PDF integrado: usa el visor nativo del navegador (iframe +
 * fragmento #page=N), sin librerías adicionales. No resalta el texto
 * exacto de la cita -- eso requeriría un visor propio con pdf.js -- pero
 * salta directamente a la página correcta, que es el requisito principal.
 */
export function PdfViewerModal({ documentId, documentTitle, page, onClose }: PdfViewerModalProps) {
  const [url, setUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetch(`/api/documents/${documentId}/view-url`)
      .then((res) => res.json())
      .then((body) => {
        if (cancelled) return;
        if (body.error) setError(body.error);
        else setUrl(body.url);
      })
      .catch((err) => !cancelled && setError(String(err)));
    return () => {
      cancelled = true;
    };
  }, [documentId]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
      onClick={onClose}
    >
      <div
        className="flex h-full w-full max-w-4xl flex-col overflow-hidden rounded-xl bg-white dark:bg-stone-900"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-stone-200 px-4 py-2.5 dark:border-stone-800">
          <p className="truncate text-sm font-medium text-stone-900 dark:text-stone-50">
            {documentTitle} — página {page}
          </p>
          <button
            type="button"
            onClick={onClose}
            className="rounded-md p-1.5 text-stone-400 hover:bg-stone-100 hover:text-stone-700 dark:hover:bg-stone-800"
            aria-label="Cerrar"
          >
            <X size={18} />
          </button>
        </div>
        <div className="flex-1 bg-stone-100 dark:bg-stone-950">
          {error && <p className="p-4 text-sm text-red-600 dark:text-red-400">{error}</p>}
          {url && (
            <iframe
              key={url}
              src={`${url}#page=${page}`}
              title={`${documentTitle} — página ${page}`}
              className="h-full w-full"
            />
          )}
        </div>
      </div>
    </div>
  );
}
