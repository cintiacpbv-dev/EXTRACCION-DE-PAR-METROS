import { NextResponse } from 'next/server';
import { z } from 'zod';
import { askQuestion } from '@/lib/rag/chat';

const chatSchema = z.object({
  question: z.string().min(1).max(2000),
  conversationId: z.string().uuid().optional(),
  scopeType: z.enum(['library', 'document', 'documents', 'collection']).optional(),
  scopeIds: z.array(z.string().uuid()).optional(),
});

export async function POST(request: Request) {
  const body = await request.json().catch(() => null);
  const parsed = chatSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  try {
    const result = await askQuestion({
      question: parsed.data.question,
      conversationId: parsed.data.conversationId,
      scopeType: parsed.data.scopeType,
      scopeIds: parsed.data.scopeIds,
    });
    return NextResponse.json(result);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
