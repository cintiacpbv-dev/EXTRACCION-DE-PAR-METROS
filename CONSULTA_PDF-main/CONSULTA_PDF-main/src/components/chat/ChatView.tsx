'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useSearchParams, useRouter } from 'next/navigation';
import { Send, Plus, BookOpen, ChevronDown, ChevronUp, Brain, X, Zap, History } from 'lucide-react';
import { PdfViewerModal } from '@/components/viewer/PdfViewerModal';

interface ChatSource {
  documentId: string;
  documentTitle: string;
  pageStart: number;
  pageEnd: number;
  quote: string;
}

interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
  confidence?: number;
  foundInDocuments?: boolean;
  sources?: ChatSource[];
  reasoning?: string | null;
  usedFallbackProvider?: boolean;
}

interface ConversationSummary {
  id: string;
  title: string | null;
  updated_at: string;
  scope_type: string;
}

interface ViewerState {
  documentId: string;
  documentTitle: string;
  page: number;
}

function ReasoningBlock({ reasoning }: { reasoning: string }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="mb-2">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="flex items-center gap-1.5 rounded-md px-1.5 py-1 text-xs font-medium text-stone-500 hover:bg-stone-100 dark:text-stone-400 dark:hover:bg-stone-800"
      >
        <Brain size={13} />
        Razonamiento
        {open ? <ChevronUp size={13} /> : <ChevronDown size={13} />}
      </button>
      {open && (
        <div className="mt-1 whitespace-pre-wrap rounded-lg border border-stone-200 bg-stone-50 p-3 text-xs italic text-stone-500 dark:border-stone-800 dark:bg-stone-900/60 dark:text-stone-400">
          {reasoning}
        </div>
      )}
    </div>
  );
}

export function ChatView() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const scopeDocumentId = searchParams.get('documentId');
  const scopeDocumentTitle = searchParams.get('title');
  const incomingQuestion = searchParams.get('q');

  const [conversations, setConversations] = useState<ConversationSummary[]>([]);
  const [activeConversationId, setActiveConversationId] = useState<string | undefined>(undefined);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [viewer, setViewer] = useState<ViewerState | null>(null);
  const [historyOpen, setHistoryOpen] = useState(false);
  const autoSentRef = useRef(false);

  const loadConversations = useCallback(async () => {
    const res = await fetch('/api/conversations');
    const body = await res.json();
    if (res.ok) setConversations(body.conversations);
  }, []);

  useEffect(() => {
    let cancelled = false;
    const run = async () => {
      if (!cancelled) await loadConversations();
    };
    run();
    return () => {
      cancelled = true;
    };
  }, [loadConversations]);

  async function loadConversation(id: string) {
    setError(null);
    const res = await fetch(`/api/conversations/${id}`);
    const body = await res.json();
    if (!res.ok) {
      setError(body.error ?? 'No se pudo cargar la conversación');
      return;
    }
    setActiveConversationId(id);
    setMessages(
      body.messages.map((m: {
        role: 'user' | 'assistant';
        content: string;
        confidence: number | null;
        sources: { document_id: string; page_number: number; quote: string; documents: { title: string } | null }[];
      }) => ({
        role: m.role,
        content: m.content,
        confidence: m.confidence ?? undefined,
        sources: (m.sources ?? []).map((s) => ({
          documentId: s.document_id,
          documentTitle: s.documents?.title ?? 'Documento',
          pageStart: s.page_number,
          pageEnd: s.page_number,
          quote: s.quote,
        })),
      })),
    );
    setHistoryOpen(false);
  }

  function startNewConversation() {
    setActiveConversationId(undefined);
    setMessages([]);
    setError(null);
    setHistoryOpen(false);
  }

  async function handleDeleteConversation(id: string, e: React.MouseEvent) {
    e.stopPropagation();
    const previous = conversations;
    setConversations((prev) => prev.filter((c) => c.id !== id));
    if (activeConversationId === id) startNewConversation();
    const res = await fetch(`/api/conversations/${id}`, { method: 'DELETE' });
    if (!res.ok) {
      setConversations(previous);
      setError('No se pudo eliminar la conversación');
    }
  }

  async function sendQuestion(question: string) {
    if (!question || loading) return;

    setInput('');
    setError(null);
    setMessages((prev) => [...prev, { role: 'user', content: question }]);
    setLoading(true);

    try {
      const res = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          question,
          conversationId: activeConversationId,
          scopeType: scopeDocumentId ? 'document' : undefined,
          scopeIds: scopeDocumentId ? [scopeDocumentId] : undefined,
        }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error ?? 'Error al consultar');

      const isNewConversation = !activeConversationId;
      setActiveConversationId(body.conversationId);
      setMessages((prev) => [
        ...prev,
        {
          role: 'assistant',
          content: body.answer,
          confidence: body.confidence,
          foundInDocuments: body.foundInDocuments,
          sources: body.sources,
          reasoning: body.reasoning,
          usedFallbackProvider: body.usedFallbackProvider,
        },
      ]);
      if (isNewConversation) loadConversations();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Error al consultar');
    } finally {
      setLoading(false);
    }
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    sendQuestion(input.trim());
  }

  // Pregunta que llega desde la barra de búsqueda de la Biblioteca
  // (?q=...): se envía sola en cuanto se monta el chat, una sola vez, y
  // se limpia de la URL para que un refresh no la reenvíe.
  useEffect(() => {
    if (incomingQuestion && !autoSentRef.current) {
      autoSentRef.current = true;
      sendQuestion(incomingQuestion.trim());
      const params = new URLSearchParams(searchParams.toString());
      params.delete('q');
      router.replace(params.size > 0 ? `/chat?${params.toString()}` : '/chat');
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- solo debe correr al montar
  }, []);

  return (
    <div className="flex flex-1 overflow-hidden">
      {/* Fondo oscuro solo en móvil, cierra el panel al tocarlo */}
      {historyOpen && (
        <div
          className="fixed inset-0 z-30 bg-black/40 md:hidden"
          onClick={() => setHistoryOpen(false)}
          aria-hidden
        />
      )}

      <aside
        className={`fixed inset-y-0 left-0 z-40 flex w-64 -translate-x-full flex-col gap-1 border-r border-stone-200 bg-stone-50 p-3 transition-transform duration-200 ease-out dark:border-stone-800 dark:bg-stone-950 md:relative md:z-auto md:w-60 md:translate-x-0 md:bg-transparent dark:md:bg-transparent ${
          historyOpen ? 'translate-x-0' : ''
        }`}
      >
        <div className="mb-2 flex items-center justify-between gap-2">
          <button
            type="button"
            onClick={startNewConversation}
            className="flex flex-1 items-center gap-1.5 rounded-lg border border-stone-300 px-3 py-1.5 text-sm font-medium text-stone-700 hover:bg-stone-100 dark:border-stone-700 dark:text-stone-300 dark:hover:bg-stone-800"
          >
            <Plus size={15} />
            Nueva conversación
          </button>
          <button
            type="button"
            onClick={() => setHistoryOpen(false)}
            className="shrink-0 rounded-md p-1.5 text-stone-500 hover:bg-stone-200 dark:hover:bg-stone-800 md:hidden"
            aria-label="Cerrar historial"
          >
            <X size={18} />
          </button>
        </div>
        <div className="flex flex-col gap-0.5 overflow-y-auto">
          {conversations.map((c) => (
            <div
              key={c.id}
              className={`group/conv flex items-center gap-1 rounded-lg pr-1 text-sm ${
                c.id === activeConversationId
                  ? 'bg-orange-100 text-orange-900 dark:bg-orange-500/15 dark:text-orange-300'
                  : 'text-stone-600 hover:bg-stone-100 dark:text-stone-400 dark:hover:bg-stone-800/60'
              }`}
            >
              <button
                type="button"
                onClick={() => loadConversation(c.id)}
                className="min-w-0 flex-1 truncate px-3 py-2 text-left"
              >
                {c.title || 'Conversación'}
              </button>
              <button
                type="button"
                onClick={(e) => handleDeleteConversation(c.id, e)}
                className="shrink-0 rounded-md p-1 text-stone-400 opacity-100 hover:bg-red-50 hover:text-red-600 md:opacity-0 md:group-hover/conv:opacity-100 dark:hover:bg-red-500/10"
                aria-label={`Eliminar conversación ${c.title ?? ''}`}
                title="Eliminar conversación"
              >
                <X size={13} />
              </button>
            </div>
          ))}
        </div>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <div className="flex items-center gap-2 border-b border-stone-200 px-3 py-2 dark:border-stone-800 md:hidden">
          <button
            type="button"
            onClick={() => setHistoryOpen(true)}
            className="flex items-center gap-1.5 rounded-lg px-2 py-1 text-sm text-stone-600 hover:bg-stone-100 dark:text-stone-300 dark:hover:bg-stone-800"
          >
            <History size={16} />
            Conversaciones
          </button>
        </div>

        {scopeDocumentId && (
          <div className="border-b border-stone-200 bg-orange-50 px-4 py-2 text-xs text-orange-800 dark:border-stone-800 dark:bg-orange-500/10 dark:text-orange-300">
            Preguntando solo sobre: <strong>{scopeDocumentTitle ?? 'este documento'}</strong>
          </div>
        )}

        <div className="flex-1 overflow-y-auto p-4 sm:p-6">
          {messages.length === 0 ? (
            <div className="flex h-full flex-col items-center justify-center gap-2 text-center">
              <div className="mb-2 flex h-12 w-12 items-center justify-center rounded-2xl bg-orange-600 text-white">
                <BookOpen size={22} />
              </div>
              <p className="text-stone-600 dark:text-stone-300">
                {scopeDocumentId ? 'Pregunta sobre este documento.' : 'Pregunta lo que quieras sobre tu biblioteca.'}
              </p>
              <p className="text-sm text-stone-400 dark:text-stone-500">
                Las respuestas se basan únicamente en tus documentos, con fuentes citadas.
              </p>
            </div>
          ) : (
            <div className="mx-auto flex max-w-2xl flex-col gap-6">
              {messages.map((m, i) =>
                m.role === 'user' ? (
                  <div key={i} className="flex justify-end">
                    <div className="max-w-[80%] rounded-2xl bg-stone-900 px-4 py-2.5 text-sm text-white dark:bg-stone-100 dark:text-stone-900">
                      <p className="whitespace-pre-wrap">{m.content}</p>
                    </div>
                  </div>
                ) : (
                  <div key={i} className="flex items-start gap-3">
                    <div className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-orange-600 text-white">
                      <BookOpen size={13} />
                    </div>
                    <div className="min-w-0 flex-1 text-sm text-stone-900 dark:text-stone-50">
                      {m.usedFallbackProvider && (
                        <span
                          className="mb-1.5 inline-flex items-center gap-1 rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-800 dark:bg-amber-500/15 dark:text-amber-400"
                          title="Gemini no estaba disponible (cuota agotada) -- esta respuesta la generó el modelo de respaldo (Groq)."
                        >
                          <Zap size={11} />
                          Generado con IA de respaldo
                        </span>
                      )}
                      {m.reasoning && <ReasoningBlock reasoning={m.reasoning} />}
                      <p className="whitespace-pre-wrap">{m.content}</p>
                      {m.sources && m.sources.length > 0 && (
                        <div className="mt-3 flex flex-col gap-1.5 border-t border-stone-200 pt-2 dark:border-stone-800">
                          {m.sources.map((s, si) => (
                            <button
                              key={si}
                              type="button"
                              onClick={() =>
                                setViewer({ documentId: s.documentId, documentTitle: s.documentTitle, page: s.pageStart })
                              }
                              className="cursor-pointer rounded-md p-1 text-left text-xs text-stone-500 hover:bg-stone-100 hover:text-stone-700 dark:text-stone-400 dark:hover:bg-stone-800 dark:hover:text-stone-200"
                            >
                              <span className="inline-flex items-center gap-1 font-medium">
                                <BookOpen size={11} /> {s.documentTitle} — página {s.pageStart}
                                {s.pageEnd !== s.pageStart ? `-${s.pageEnd}` : ''}
                              </span>
                              <p className="mt-0.5 italic text-stone-400 dark:text-stone-500">“{s.quote}”</p>
                            </button>
                          ))}
                        </div>
                      )}
                    </div>
                  </div>
                ),
              )}
              {loading && (
                <div className="flex items-center gap-3">
                  <div className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-orange-600 text-white">
                    <BookOpen size={13} />
                  </div>
                  <div className="flex items-center gap-1 text-sm text-stone-400 dark:text-stone-500">
                    <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-stone-400 [animation-delay:-0.3s]" />
                    <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-stone-400 [animation-delay:-0.15s]" />
                    <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-stone-400" />
                  </div>
                </div>
              )}
            </div>
          )}
        </div>

        {error && (
          <div className="mx-6 mb-2 rounded-lg border border-red-200 bg-red-50 px-4 py-2 text-sm text-red-700 dark:border-red-500/20 dark:bg-red-500/10 dark:text-red-400">
            {error}
          </div>
        )}

        <form onSubmit={handleSubmit} className="border-t border-stone-200 p-4 dark:border-stone-800">
          <div className="mx-auto flex max-w-2xl gap-2">
            <input
              type="text"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder={scopeDocumentId ? 'Pregunta sobre este documento…' : 'Pregunta sobre tu biblioteca…'}
              disabled={loading}
              className="flex-1 rounded-full border border-stone-300 bg-white px-4 py-2.5 text-sm text-stone-900 outline-none focus:border-orange-500 disabled:opacity-50 dark:border-stone-700 dark:bg-stone-900 dark:text-stone-50"
            />
            <button
              type="submit"
              disabled={loading || !input.trim()}
              className="flex items-center justify-center rounded-full bg-orange-600 p-2.5 text-white hover:bg-orange-700 disabled:opacity-50"
              aria-label="Enviar"
            >
              <Send size={16} />
            </button>
          </div>
        </form>
      </div>

      {viewer && (
        <PdfViewerModal
          documentId={viewer.documentId}
          documentTitle={viewer.documentTitle}
          page={viewer.page}
          onClose={() => setViewer(null)}
        />
      )}
    </div>
  );
}
