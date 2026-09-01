import { NextResponse } from 'next/server';
import { z } from 'zod';
import { getSupabaseAdmin } from '@/lib/supabase/admin';

export async function GET() {
  const supabase = getSupabaseAdmin();
  const { data: collections, error } = await supabase
    .from('collections')
    .select('*')
    .order('created_at', { ascending: false });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const { data: links } = await supabase.from('collection_documents').select('collection_id');
  const counts = new Map<string, number>();
  for (const l of links ?? []) {
    counts.set(l.collection_id, (counts.get(l.collection_id) ?? 0) + 1);
  }

  return NextResponse.json({
    collections: (collections ?? []).map((c) => ({ ...c, document_count: counts.get(c.id) ?? 0 })),
  });
}

const createSchema = z.object({
  name: z.string().min(1).max(200),
  description: z.string().max(1000).optional(),
});

export async function POST(request: Request) {
  const body = await request.json().catch(() => null);
  const parsed = createSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase
    .from('collections')
    .insert({ name: parsed.data.name, description: parsed.data.description ?? null })
    .select('*')
    .single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ collection: data });
}
