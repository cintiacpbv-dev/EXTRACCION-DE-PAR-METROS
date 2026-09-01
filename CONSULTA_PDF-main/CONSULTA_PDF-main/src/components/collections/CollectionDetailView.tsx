'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { ArrowLeft, Plus, X, FileText } from 'lucide-react';
import type { CollectionRow, DocumentRow } from '@/types/database';

export function CollectionDetailView({
  collection,
  initialDocuments,
  allDocuments,
}: {
  collection: CollectionRow;
  initialDocuments: DocumentRow[];
  allDocuments: DocumentRow[];
}) {
  const router = useRouter();
  const [documents, setDocuments] = useState(initialDocuments);
  const [picking, setPicking] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const availableToAdd = allDocuments.filter((d) => !documents.some((doc) => doc.id === d.id));

  async function handleAdd(documentId: string) {
    setError(null);
    const res = await fetch(`/api/collections/${collection.id}/documents`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ documentId }),
    });
    if (!res.ok) {
      setError('No se pudo añadir el documento');
      return;
    }
    const doc = allDocuments.find((d) => d.id === documentId);
    if (doc) setDocuments((prev) => [...prev, doc]);
    setPicking(false);
  }

  async function handleRemove(documentId: string) {
    const previous = documents;
    setDocuments((prev) => prev.filter((d) => d.id !== documentId));
    const res = await fetch(`/api/collections/${collection.id}/documents/${documentId}`, { method: 'DELETE' });
    if (!res.ok) {
      setDocuments(previous);
      setError('No se pudo quitar el documento');
    }
  }

  return (
    <div className="flex flex-1 flex-col gap-6 p-6">
      <div className="flex items-center gap-3">
        <button
          type="button"
          onClick={() => router.push('/collections')}
          className="rounded-lg p-1.5 text-stone-500 hover:bg-stone-100 dark:hover:bg-stone-800"
          aria-label="Volver a colecciones"
        >
          <ArrowLeft size={18} />
        </button>
        <div>
          <h1 className="text-xl font-semibold text-stone-900 dark:text-stone-50">{collection.name}</h1>
          <p className="text-sm text-stone-500 dark:text-stone-400">
            {documents.length} documento{documents.length === 1 ? '' : 's'}
          </p>
        </div>
      </div>

      <div className="relative">
        <button
          type="button"
          onClick={() => setPicking((p) => !p)}
          className="flex items-center gap-1.5 rounded-lg bg-orange-600 px-4 py-2 text-sm font-medium text-white hover:bg-orange-700"
        >
          <Plus size={15} />
          Añadir documento
        </button>
        {picking && (
          <div className="absolute z-10 mt-2 max-h-72 w-80 overflow-y-auto rounded-xl border border-stone-200 bg-white p-2 shadow-lg dark:border-stone-800 dark:bg-stone-900">
            {availableToAdd.length === 0 ? (
              <p className="p-3 text-sm text-stone-500 dark:text-stone-400">
                Todos tus documentos ya están en esta colección.
              </p>
            ) : (
              availableToAdd.map((d) => (
                <button
                  key={d.id}
                  type="button"
                  onClick={() => handleAdd(d.id)}
                  className="flex w-full items-center gap-2 truncate rounded-lg px-3 py-2 text-left text-sm text-stone-700 hover:bg-stone-100 dark:text-stone-300 dark:hover:bg-stone-800"
                >
                  <FileText size={14} className="shrink-0 text-stone-400" />
                  <span className="truncate">{d.title}</span>
                </button>
              ))
            )}
          </div>
        )}
      </div>

      {error && (
        <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-2 text-sm text-red-700 dark:border-red-500/20 dark:bg-red-500/10 dark:text-red-400">
          {error}
        </div>
      )}

      {documents.length === 0 ? (
        <div className="flex flex-1 flex-col items-center justify-center gap-2 rounded-xl border border-dashed border-stone-300 py-24 text-center dark:border-stone-700">
          <p className="text-stone-500 dark:text-stone-400">Esta colección está vacía.</p>
          <p className="text-sm text-stone-400 dark:text-stone-500">Añade documentos con el botón de arriba.</p>
        </div>
      ) : (
        <div className="flex flex-col gap-2">
          {documents.map((d) => (
            <div
              key={d.id}
              className="flex items-center justify-between gap-2 rounded-lg border border-stone-200 bg-white px-4 py-3 dark:border-stone-800 dark:bg-stone-900"
            >
              <div className="flex min-w-0 items-center gap-3">
                <FileText size={16} className="shrink-0 text-orange-600 dark:text-orange-400" />
                <span className="truncate text-sm text-stone-900 dark:text-stone-50">{d.title}</span>
              </div>
              <button
                type="button"
                onClick={() => handleRemove(d.id)}
                className="shrink-0 rounded-md p-1.5 text-stone-400 hover:bg-red-50 hover:text-red-600 dark:hover:bg-red-500/10"
                aria-label={`Quitar ${d.title} de la colección`}
              >
                <X size={16} />
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
