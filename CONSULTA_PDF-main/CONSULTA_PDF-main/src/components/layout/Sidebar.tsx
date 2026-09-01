'use client';

import { usePathname } from 'next/navigation';
import { Library, MessageSquare, FolderOpen, Star, BookOpen, X } from 'lucide-react';

const NAV_ITEMS = [
  { label: 'Biblioteca', icon: Library, href: '/' },
  { label: 'Consulta', icon: MessageSquare, href: '/chat' },
  { label: 'Colecciones', icon: FolderOpen, href: '/collections' },
  { label: 'Favoritos', icon: Star, href: '/favorites' },
];

export function Sidebar({ open, onClose }: { open: boolean; onClose: () => void }) {
  const pathname = usePathname();

  return (
    <>
      {/* Fondo oscuro solo en móvil, cierra el panel al tocarlo */}
      {open && (
        <div
          className="fixed inset-0 z-40 bg-black/40 md:hidden"
          onClick={onClose}
          aria-hidden
        />
      )}

      <aside
        className={`fixed inset-y-0 left-0 z-50 flex w-64 shrink-0 -translate-x-full flex-col gap-1 border-r border-stone-200 bg-stone-100 p-4 transition-transform duration-200 ease-out dark:border-stone-800 dark:bg-stone-950 md:relative md:z-auto md:w-60 md:translate-x-0 ${
          open ? 'translate-x-0' : ''
        }`}
      >
        <div className="mb-5 flex items-center justify-between gap-2 px-2">
          <div className="flex items-center gap-2">
            <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-orange-600 text-white">
              <BookOpen size={16} strokeWidth={2.25} />
            </div>
            <p className="text-sm font-semibold text-stone-900 dark:text-stone-50">Consulta a tu PDF</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-md p-1 text-stone-500 hover:bg-stone-200 dark:hover:bg-stone-800 md:hidden"
            aria-label="Cerrar menú"
          >
            <X size={18} />
          </button>
        </div>
        {NAV_ITEMS.map((item) => {
          const active = pathname === item.href || (item.href !== '/' && pathname?.startsWith(item.href));
          const Icon = item.icon;
          return (
            <a
              key={item.label}
              href={item.href}
              onClick={onClose}
              className={`flex items-center gap-2.5 rounded-lg px-3 py-2.5 text-sm font-medium transition-colors ${
                active
                  ? 'bg-orange-100 text-orange-900 dark:bg-orange-500/15 dark:text-orange-300'
                  : 'text-stone-600 hover:bg-stone-200/70 dark:text-stone-400 dark:hover:bg-stone-800/70'
              }`}
            >
              <Icon size={17} strokeWidth={2} />
              {item.label}
            </a>
          );
        })}
      </aside>
    </>
  );
}
