/**
 * Tipos manuales que reflejan supabase/migrations/20260816000000_initial_schema.sql
 * Cuando el esquema cambie, actualizar este archivo (o generar con
 * `supabase gen types typescript` una vez el proyecto esté enlazado).
 */

export type DocumentStatus = 'pending' | 'processing' | 'ready' | 'error';
export type ProcessingJobStatus = 'queued' | 'processing' | 'completed' | 'failed';
export type PageProcessingMethod = 'text_extraction' | 'vision';
export type ChunkContentType = 'text' | 'table' | 'image' | 'formula' | 'mixed';
export type ConversationScopeType = 'library' | 'document' | 'documents' | 'collection';
export type MessageRole = 'user' | 'assistant';

export interface CollectionRow {
  id: string;
  name: string;
  description: string | null;
  created_at: string;
}

export interface DocumentRow {
  id: string;
  title: string;
  author: string | null;
  file_hash: string;
  storage_path: string;
  mime_type: string;
  file_size_bytes: number;
  page_count: number | null;
  status: DocumentStatus;
  processing_progress: number;
  processing_error: string | null;
  is_favorite: boolean;
  created_at: string;
  updated_at: string;
}

export interface ProcessingJobRow {
  id: string;
  document_id: string;
  status: ProcessingJobStatus;
  current_stage: string | null;
  last_page_processed: number;
  retry_count: number;
  error_message: string | null;
  created_at: string;
  updated_at: string;
}

export interface DocumentPageRow {
  id: string;
  document_id: string;
  page_number: number;
  has_native_text: boolean;
  processing_method: PageProcessingMethod;
  raw_text: string | null;
  content_type_hint: ChunkContentType | null;
  created_at: string;
}

export interface DocumentChunkRow {
  id: string;
  document_id: string;
  parent_chunk_id: string | null;
  page_start: number;
  page_end: number;
  chapter: string | null;
  section: string | null;
  content_type: ChunkContentType;
  position: number;
  content: string;
  content_hash: string;
  token_count: number | null;
  created_at: string;
}

export interface DocumentEmbeddingRow {
  chunk_id: string;
  document_id: string;
  embedding: number[];
  model_version: string;
  created_at: string;
}

export interface CollectionDocumentRow {
  collection_id: string;
  document_id: string;
}

export interface ConversationRow {
  id: string;
  title: string | null;
  scope_type: ConversationScopeType;
  scope_ids: string[];
  created_at: string;
  updated_at: string;
}

export interface MessageRow {
  id: string;
  conversation_id: string;
  role: MessageRole;
  content: string;
  confidence: number | null;
  created_at: string;
}

export interface MessageSourceRow {
  id: string;
  message_id: string;
  chunk_id: string;
  document_id: string;
  page_number: number;
  quote: string;
  relevance_score: number | null;
}

export interface MatchDocumentChunkRow {
  chunk_id: string;
  document_id: string;
  content: string;
  page_start: number;
  page_end: number;
  chapter: string | null;
  section: string | null;
  similarity: number;
}

/**
 * Nota: no exportamos un tipo `Database` para pasar como genérico a
 * `createClient<Database>` — sin introspección real del esquema, un
 * `Database` escrito a mano choca con los tipos internos de supabase-js.
 * En su lugar, los call sites tipan explícitamente los resultados con las
 * interfaces de este archivo (`as DocumentRow`, etc). Cuando el proyecto
 * esté enlazado a un Supabase real, generar tipos con
 * `supabase gen types typescript` y usarlos en su lugar.
 */
