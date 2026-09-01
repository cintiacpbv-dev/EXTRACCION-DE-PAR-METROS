'use client';

import { useState } from 'react';
import { Menu, BookOpen } from 'lucide-react';
import { Sidebar } from './Sidebar';

export function AppShell({ children }: { children: React.ReactNode }) {
  const [menuOpen, setMenuOpen] = useState(false);

  return (
    <div className="flex min-h-full w-full flex-col md:flex-row">
      {/* Barra superior: solo en móvil, reemplaza al sidebar fijo */}
      <header className="flex shrink-0 items-center gap-3 border-b border-stone-200 bg-stone-100 px-4 py-3 dark:border-stone-800 dark:bg-stone-950 md:hidden">
        <button
          type="button"
          onClick={() => setMenuOpen(true)}
          className="rounded-md p-1.5 text-stone-600 hover:bg-stone-200/70 dark:text-stone-300 dark:hover:bg-stone-800/70"
          aria-label="Abrir menú"
        >
          <Menu size={20} />
        </button>
        <div className="flex h-6 w-6 items-center justify-center rounded-md bg-orange-600 text-white">
          <BookOpen size={13} strokeWidth={2.25} />
        </div>
        <p className="text-sm font-semibold text-stone-900 dark:text-stone-50">Consulta a tu PDF</p>
      </header>

      {/* El propio Sidebar cierra el panel (onClose) al hacer clic en un
          enlace de navegación -- no hace falta un efecto extra aquí. */}
      <Sidebar open={menuOpen} onClose={() => setMenuOpen(false)} />

      <main className="flex min-w-0 flex-1 flex-col">{children}</main>
    </div>
  );
}
