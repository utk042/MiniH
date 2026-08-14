import { supabaseServer } from '../supabase/server';
import type { WantStatus } from '../supabase/types';

export interface WantRow {
  wantId: string;
  canonicalKey: string;
  title: string;
  authors: string[];
  editionLabel: string | null;
  priority: number;
  editionStrict: boolean;
  status: WantStatus;
  note: string | null;
  createdAt: string;
}

interface RawRow {
  id: string;
  canonical_key: string;
  priority: number;
  edition_strict: boolean;
  status: WantStatus;
  note: string | null;
  created_at: string;
  books: { title: string; authors: string[]; edition_label: string | null } | null;
}

/** Private to the caller — RLS enforces that server-side, this trusts it. */
export async function listMyWants(userId: string): Promise<WantRow[]> {
  const supabase = await supabaseServer();

  const { data, error } = await supabase
    .from('wants')
    .select('id, canonical_key, priority, edition_strict, status, note, created_at, books!wants_canonical_key_fkey(title, authors, edition_label)')
    .eq('user_id', userId)
    .order('priority', { ascending: true })
    .returns<RawRow[]>();

  if (error || !data) return [];

  return data
    .filter((row): row is RawRow & { books: NonNullable<RawRow['books']> } => row.books !== null)
    .map((row) => ({
      wantId: row.id,
      canonicalKey: row.canonical_key,
      title: row.books.title,
      authors: row.books.authors,
      editionLabel: row.books.edition_label,
      priority: row.priority,
      editionStrict: row.edition_strict,
      status: row.status,
      note: row.note,
      createdAt: row.created_at,
    }));
}
