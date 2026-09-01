import { getSupabaseAdmin } from '@/lib/supabase/admin';
import { hybridSearch } from './retrieval';
import { generateAnswer } from './answer';
import type { ConversationScopeType } from '@/types/database';

const HISTORY_TURNS = 6;

export interface ChatSource {
  documentId: string;
  documentTitle: string;
  pageStart: number;
  pageEnd: number;
  quote: string;
}

export interface ChatResult {
  conversationId: string;
  answer: string;
  foundInDocuments: boolean;
  confidence: number;
  sources: ChatSource[];
  reasoning: string | null;
  usedFallbackProvider: boolean;
}

const NOT_FOUND_ANSWER =
  'No encuentro información suficiente sobre esto en los documentos disponibles.';

export async function askQuestion(params: {
  question: string;
  conversationId?: string;
  scopeType?: ConversationScopeType;
  scopeIds?: string[];
}): Promise<ChatResult> {
  const supabase = getSupabaseAdmin();
  const { question, scopeType = 'library', scopeIds = [] } = params;

  let conversationId = params.conversationId;
  if (!conversationId) {
    const { data: conversation, error } = await supabase
      .from('conversations')
      .insert({ scope_type: scopeType, scope_ids: scopeIds, title: question.slice(0, 80) })
      .select('id')
      .single();
    if (error || !conversation) throw new Error(error?.message ?? 'No se pudo crear la conversación');
    conversationId = conversation.id;
  }
  // En este punto siempre está definido (recién creado arriba o venía en params).
  const resolvedConversationId = conversationId as string;

  const { data: historyRows } = await supabase
    .from('messages')
    .select('role, content')
    .eq('conversation_id', resolvedConversationId)
    .order('created_at', { ascending: false })
    .limit(HISTORY_TURNS);
  const conversationHistory = (historyRows ?? []).reverse() as { role: 'user' | 'assistant'; content: string }[];

  await supabase
    .from('messages')
    .insert({ conversation_id: resolvedConversationId, role: 'user', content: question });

  // Para resolver referencias ("eso", "el anterior") sin una llamada extra
  // a Gemini solo para reescribir la query: se concatena el último turno
  // de usuario con la pregunta actual para el embedding de retrieval.
  const lastUserTurn = [...conversationHistory].reverse().find((m) => m.role === 'user');
  const retrievalQuery = lastUserTurn ? `${lastUserTurn.content}\n${question}` : question;

  const documentIds = scopeType === 'library' ? undefined : scopeIds;
  const chunks = await hybridSearch(retrievalQuery, { documentIds });

  if (chunks.length === 0) {
    await supabase.from('messages').insert({
      conversation_id: resolvedConversationId,
      role: 'assistant',
      content: NOT_FOUND_ANSWER,
      confidence: 0,
    });
    await supabase
      .from('conversations')
      .update({ updated_at: new Date().toISOString() })
      .eq('id', resolvedConversationId);
    return {
      conversationId: resolvedConversationId,
      answer: NOT_FOUND_ANSWER,
      foundInDocuments: false,
      confidence: 0,
      sources: [],
      reasoning: null,
      usedFallbackProvider: false,
    };
  }

  const documentIdsInChunks = [...new Set(chunks.map((c) => c.documentId))];
  const { data: documents } = await supabase
    .from('documents')
    .select('id, title')
    .in('id', documentIdsInChunks);
  const documentTitles = new Map((documents ?? []).map((d) => [d.id, d.title]));

  const result = await generateAnswer({
    question,
    chunks,
    documentTitles,
    // conversationHistory ya se leyó antes de insertar la pregunta actual,
    // así que no incluye el turno recién insertado.
    conversationHistory,
  });

  const { data: assistantMessage, error: assistantError } = await supabase
    .from('messages')
    .insert({
      conversation_id: resolvedConversationId,
      role: 'assistant',
      content: result.answer,
      confidence: result.confidence,
    })
    .select('id')
    .single();
  if (assistantError || !assistantMessage) {
    throw new Error(assistantError?.message ?? 'No se pudo guardar la respuesta');
  }
  await supabase
    .from('conversations')
    .update({ updated_at: new Date().toISOString() })
    .eq('id', resolvedConversationId);

  if (result.sources.length > 0) {
    await supabase.from('message_sources').insert(
      result.sources.map((s) => ({
        message_id: assistantMessage.id,
        chunk_id: s.chunkId,
        document_id: s.documentId,
        page_number: s.pageStart,
        quote: s.quote,
      })),
    );
  }

  return {
    conversationId: resolvedConversationId,
    answer: result.answer,
    foundInDocuments: result.foundInDocuments,
    confidence: result.confidence,
    sources: result.sources.map((s) => ({
      documentId: s.documentId,
      documentTitle: documentTitles.get(s.documentId) ?? 'Documento',
      pageStart: s.pageStart,
      pageEnd: s.pageEnd,
      quote: s.quote,
    })),
    reasoning: result.reasoning,
    usedFallbackProvider: result.usedFallbackProvider,
  };
}
