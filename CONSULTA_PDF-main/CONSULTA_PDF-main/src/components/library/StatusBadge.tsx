import { Clock, Loader2, CheckCircle2, AlertCircle } from 'lucide-react';
import type { DocumentStatus } from '@/types/database';

const STYLES: Record<DocumentStatus, string> = {
  pending: 'bg-amber-100 text-amber-800 dark:bg-amber-500/15 dark:text-amber-400',
  processing: 'bg-blue-100 text-blue-800 dark:bg-blue-500/15 dark:text-blue-400',
  ready: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-500/15 dark:text-emerald-400',
  error: 'bg-red-100 text-red-800 dark:bg-red-500/15 dark:text-red-400',
};

const LABELS: Record<DocumentStatus, string> = {
  pending: 'Pendiente de procesamiento',
  processing: 'Procesando…',
  ready: 'Listo para consultar',
  error: 'Error',
};

const ICONS: Record<DocumentStatus, typeof Clock> = {
  pending: Clock,
  processing: Loader2,
  ready: CheckCircle2,
  error: AlertCircle,
};

export function StatusBadge({ status }: { status: DocumentStatus }) {
  const Icon = ICONS[status];
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-medium ${STYLES[status]}`}
    >
      <Icon size={12} className={status === 'processing' ? 'animate-spin' : ''} />
      {LABELS[status]}
    </span>
  );
}
