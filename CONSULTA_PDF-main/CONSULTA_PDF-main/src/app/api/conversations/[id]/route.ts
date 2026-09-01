import { NextResponse } from 'next/server';
import { getSupabaseAdmin } from '@/lib/supabase/admin';

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const supabase = getSupabaseAdmin();

  const { data: conversation, error: convError } = await supabase
    .from('conversations')
    .select('*')
    .eq('id', id)
    .maybeSingle();
  if (convError) return NextResponse.json({ error: convError.message }, { status: 500 });
  if (!conversation) return NextResponse.json({ error: 'Conversación no encontrada' }, { status: 404 });

  const { data: messages, error: msgError } = await supabase
    .from('messages')
    .select('*')
    .eq('conversation_id', id)
    .order('created_at', { ascending: true });
  if (msgError) return NextResponse.json({ error: msgError.message }, { status: 500 });

  // Filtrado por conversation_id vía join, NUNCA por una lista de
  // message_id: una conversación larga podría acumular suficientes
  // mensajes como para que `.in('message_id', [...])` reprodujera el
  // mismo bug de "URL de query demasiado larga -> 400 Bad Request" que
  // se encontró (y corrigió) para document_embeddings.
  const { data: sources, error: sourcesError } = await supabase
    .from('message_sources')
    .select('*, documents(title), messages!inner(conversation_id)')
    .eq('messages.conversation_id', id);
  if (sourcesError) return NextResponse.json({ error: sourcesError.message }, { status: 500 });

  const sourcesByMessage = new Map<string, unknown[]>();
  for (const s of sources ?? []) {
    const list = sourcesByMessage.get(s.message_id) ?? [];
    list.push(s);
    sourcesByMessage.set(s.message_id, list);
  }

  const messagesWithSources = (messages ?? []).map((m) => ({
    ...m,
    sources: sourcesByMessage.get(m.id) ?? [],
  }));

  return NextResponse.json({ conversation, messages: messagesWithSources });
}

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const supabase = getSupabaseAdmin();
  // messages y message_sources caen por ON DELETE CASCADE.
  const { error } = await supabase.from('conversations').delete().eq('id', id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ success: true });
}
