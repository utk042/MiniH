import { supabaseServer } from '../supabase/server';
import type { CopyCondition, CopyStatus } from '../supabase/types';

export interface ShelfRow {
  copyId: string;
  canonicalKey: string;
  title: string;
  authors: string[];
  editionLabel: string | null;
  condition: CopyCondition;
  askPriceCents: number | null;
  notes: string | null;
  description: string | null;
  status: CopyStatus;
  rawInput: string | null;
  createdAt: string;
}

interface RawRow {
  id: string;
  condition: CopyCondition;
  ask_price_cents: number | null;
  notes: string | null;
  description: string | null;
  status: CopyStatus;
  raw_input: string | null;
  created_at: string;
  books: { canonical_key: string; title: string; authors: string[]; edition_label: string | null } | null;
}

/** Everything a student has listed, including what they have withdrawn or traded. */
export async function listMyCopies(userId: string): Promise<ShelfRow[]> {
  const supabase = await supabaseServer();

  const { data, error } = await supabase
    .from('copies')
    .select(
      'id, condition, ask_price_cents, notes, description, status, raw_input, created_at, books(canonical_key, title, authors, edition_label)',
    )
    .eq('owner_id', userId)
    .order('created_at', { ascending: false })
    .returns<RawRow[]>();

  if (error || !data) return [];

  return data
    .filter((row): row is RawRow & { books: NonNullable<RawRow['books']> } => row.books !== null)
    .map((row) => ({
      copyId: row.id,
      canonicalKey: row.books.canonical_key,
      title: row.books.title,
      authors: row.books.authors,
      editionLabel: row.books.edition_label,
      condition: row.condition,
      askPriceCents: row.ask_price_cents,
      notes: row.notes,
      description: row.description,
      status: row.status,
      rawInput: row.raw_input,
      createdAt: row.created_at,
    }));
}
