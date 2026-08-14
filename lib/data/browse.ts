import { supabaseServer } from '../supabase/server';
import type { CopyCondition } from '../supabase/types';

export interface BrowseRow {
  copyId: string;
  bookId: string;
  canonicalKey: string;
  title: string;
  authors: string[];
  editionLabel: string | null;
  condition: CopyCondition;
  askPriceCents: number | null;
  subjectTags: string[];
  courseCodes: string[];
  ownerId: string;
  ownerHandle: string;
  ownerDisplayName: string;
  isMine: boolean;
}

/** The shape the embed query actually returns, before we flatten it. */
interface RawCopyRow {
  id: string;
  condition: CopyCondition;
  ask_price_cents: number | null;
  owner_id: string;
  books: {
    id: string;
    canonical_key: string;
    title: string;
    authors: string[];
    edition_label: string | null;
    subject_tags: string[];
    course_codes: string[];
  } | null;
  profiles: { handle: string; display_name: string } | null;
}

/**
 * Every open copy on campus, alphabetical by title — a card catalogue, not a
 * feed, so the order should be predictable rather than recency-driven.
 */
export async function listOpenCopies(currentUserId: string | null): Promise<BrowseRow[]> {
  const supabase = await supabaseServer();

  const { data, error } = await supabase
    .from('copies')
    .select(
      'id, condition, ask_price_cents, owner_id, books(id, canonical_key, title, authors, edition_label, subject_tags, course_codes), profiles(handle, display_name)',
    )
    .eq('status', 'open')
    .returns<RawCopyRow[]>();

  if (error || !data) return [];

  return data
    .filter((row): row is RawCopyRow & { books: NonNullable<RawCopyRow['books']> } => row.books !== null)
    .map((row) => ({
      copyId: row.id,
      bookId: row.books.id,
      canonicalKey: row.books.canonical_key,
      title: row.books.title,
      authors: row.books.authors,
      editionLabel: row.books.edition_label,
      condition: row.condition,
      askPriceCents: row.ask_price_cents,
      subjectTags: row.books.subject_tags,
      courseCodes: row.books.course_codes,
      ownerId: row.owner_id,
      ownerHandle: row.profiles?.handle ?? 'unknown',
      ownerDisplayName: row.profiles?.display_name ?? 'Unknown',
      isMine: row.owner_id === currentUserId,
    }))
    .sort((a, b) => a.title.localeCompare(b.title));
}

export interface CopyDetail extends BrowseRow {
  notes: string | null;
  description: string | null;
  demand: number;
}

export async function getCopyDetail(copyId: string, currentUserId: string | null): Promise<CopyDetail | null> {
  const supabase = await supabaseServer();

  const { data, error } = await supabase
    .from('copies')
    .select(
      'id, condition, ask_price_cents, owner_id, notes, description, books(id, canonical_key, title, authors, edition_label, subject_tags, course_codes), profiles(handle, display_name)',
    )
    .eq('id', copyId)
    .returns<Array<RawCopyRow & { notes: string | null; description: string | null }>>()
    .maybeSingle();

  if (error || !data || !data.books) return null;

  const { data: demand } = await supabase.rpc('book_demand', { p_canonical_key: data.books.canonical_key });

  return {
    copyId: data.id,
    bookId: data.books.id,
    canonicalKey: data.books.canonical_key,
    title: data.books.title,
    authors: data.books.authors,
    editionLabel: data.books.edition_label,
    condition: data.condition,
    askPriceCents: data.ask_price_cents,
    subjectTags: data.books.subject_tags,
    courseCodes: data.books.course_codes,
    ownerId: data.owner_id,
    ownerHandle: data.profiles?.handle ?? 'unknown',
    ownerDisplayName: data.profiles?.display_name ?? 'Unknown',
    isMine: data.owner_id === currentUserId,
    notes: data.notes,
    description: data.description,
    demand: demand ?? 0,
  };
}
