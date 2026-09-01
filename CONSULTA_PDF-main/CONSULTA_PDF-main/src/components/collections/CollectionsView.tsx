'use client';

import { useState } from 'react';
import Link from 'next/link';
import { FolderOpen, Plus, X } from 'lucide-react';
import { formatDate } from '@/lib/utils/format';
import type { CollectionRow } from '@/types/database';

interface CollectionSummary extends CollectionRow {
  document_count: number;
}

export function CollectionsView({ initialCollections }: { initialCollections: CollectionSummary[] }) {
  const [collections, setCollections] = useState(initialCollections);
  const [name, setName] = useState('');
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    const trimmed = name.trim();
    if (!trimmed) return;
    setCreating(true);
    setError(null);
    try {
      const res = await fetch('/api/collections', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: trimmed }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error ?? 'No se pudo crear la colección');
      setCollections((prev) => [{ ...body.collection, document_count: 0 }, ...prev]);
      setName('');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Error creando la colección');
    } finally {
      setCreating(false);
    }
  }

  async function handleDelete(id: string) {
    const previous = collections;
    setCollections((prev) => prev.filter((c) => c.id !== id));
    const res = await fetch(`/api/collections/${id}`, { method: 'DELETE' });
    if (!res.ok) {
      setCollections(previous);
      setError('No se pudo eliminar la colección');
    }
  }

  return (
    <div className="flex flex-1 flex-col gap-6 p-6">
      <div>
        <h1 className="text-xl font-semibold text-stone-900 dark:text-stone-50">Colecciones</h1>
        <p className="text-sm text-stone-500 dark:text-stone-400">
          Agrupa documentos por tema para consultarlos juntos.
        </p>
      </div>

      <form onSubmit={handleCreate} className="flex gap-2">
        <input
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Nombre de la nueva colección…"
          className="flex-1 max-w-sm rounded-lg border border-stone-300 bg-white px-3 py-2 text-sm text-stone-900 outline-none focus:border-orange-500 dark:border-stone-700 dark:bg-stone-900 dark:text-stone-50"
        />
        <button
          type="submit"
          disabled={creating || !name.trim()}
          className="flex items-center gap-1.5 rounded-lg bg-orange-600 px-4 py-2 text-sm font-medium text-white hover:bg-orange-700 disabled:opacity-50"
        >
          <Plus size={15} />
          Crear
        </button>
      </form>

      {error && (
        <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-2 text-sm text-red-700 dark:border-red-500/20 dark:bg-red-500/10 dark:text-red-400">
          {error}
        </div>
      )}

      {collections.length === 0 ? (
        <div className="flex flex-1 flex-col items-center justify-center gap-2 rounded-xl border border-dashed border-stone-300 py-24 text-center dark:border-stone-700">
          <p className="text-stone-500 dark:text-stone-400">Todavía no tienes colecciones.</p>
          <p className="text-sm text-stone-400 dark:text-stone-500">Crea una arriba para empezar a organizar tu biblioteca.</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {collections.map((c) => (
            <div
              key={c.id}
              className="flex flex-col gap-3 rounded-xl border border-stone-200 bg-white p-4 dark:border-stone-800 dark:bg-stone-900"
            >
              <div className="flex items-start justify-between gap-2">
                <Link href={`/collections/${c.id}`} className="flex min-w-0 items-center gap-3">
                  <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-orange-50 text-orange-600 dark:bg-orange-500/10 dark:text-orange-400">
                    <FolderOpen size={18} />
                  </div>
                  <div className="min-w-0">
                    <p className="truncate font-medium text-stone-900 dark:text-stone-50">{c.name}</p>
                    <p className="text-xs text-stone-500 dark:text-stone-400">
                      {c.document_count} documento{c.document_count === 1 ? '' : 's'}
                    </p>
                  </div>
                </Link>
                <button
                  type="button"
                  onClick={() => handleDelete(c.id)}
                  className="shrink-0 rounded-md p-1.5 text-stone-400 hover:bg-red-50 hover:text-red-600 dark:hover:bg-red-500/10"
                  aria-label={`Eliminar colección ${c.name}`}
                >
                  <X size={16} />
                </button>
              </div>
              <p className="text-xs text-stone-400 dark:text-stone-500">Creada el {formatDate(c.created_at)}</p>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
