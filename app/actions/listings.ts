'use server';

import { revalidatePath } from 'next/cache';
import { canonicalize } from '../../lib/canonicalize/canonicalize';
import { enrich } from '../../lib/canonicalize/enrich';
import { applyHumanOverride } from '../../lib/canonicalize/override';
import { hashInput } from '../../lib/canonicalize/normalize';
import { supabaseCache, supabaseCatalogue } from '../../lib/canonicalize/supabase-repos';
import { supabaseServer } from '../../lib/supabase/server';
import type { CopyCondition } from '../../lib/supabase/types';

export interface ResolvedListingDraft {
  rawInput: string;
  title: string;
  authors: string[];
  edition: string | null;
  editionNumber: number | null;
  subjectTags: string[];
  conditionGuess: CopyCondition | null;
  canonicalKey: string;
  workKey: string;
  source: 'cache' | 'gemini' | 'fallback' | 'human';
  matchedExistingBook: boolean;
  warnings: string[];
  tags: string[];
  description: string;
  enrichSource: 'gemini' | 'fallback';
  enrichWarnings: string[];
}

/**
 * The first tap of the two-step listing flow: free text in, a structured
 * record back for the student to review. Nothing is written to `copies` yet —
 * canonicalize() does write the cache, which is the point of the cache.
 */
export async function resolveListingDraft(
  rawInput: string,
): Promise<{ draft: ResolvedListingDraft } | { error: string }> {
  const supabase = await supabaseServer();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: 'Sign in first.' };

  try {
    const result = await canonicalize(rawInput, {
      cache: supabaseCache(supabase),
      catalogue: supabaseCatalogue(supabase),
    });

    const enrichment = await enrich({
      title: result.record.title,
      authors: result.record.authors,
      edition: result.record.edition,
      editionNumber: result.record.editionNumber,
      subjectTags: result.record.subjectTags,
      condition: result.record.conditionGuess ?? 'good',
      notes: null,
      courseCodes: [],
    });

    return {
      draft: {
        rawInput,
        title: result.record.title,
        authors: result.record.authors,
        edition: result.record.edition,
        editionNumber: result.record.editionNumber,
        subjectTags: result.record.subjectTags,
        conditionGuess: result.record.conditionGuess,
        canonicalKey: result.record.canonicalKey,
        workKey: result.record.workKey,
        source: result.source,
        matchedExistingBook: result.matchedExistingBook,
        warnings: result.warnings,
        tags: enrichment.tags,
        description: enrichment.description,
        enrichSource: enrichment.source,
        enrichWarnings: enrichment.warnings,
      },
    };
  } catch (error) {
    return { error: error instanceof Error ? error.message : 'Could not read that. Try describing it plainly: title, author, edition.' };
  }
}

export interface CreateCopyInput {
  draft: ResolvedListingDraft;
  /** Set when the student edited the title after seeing the AI's read. */
  correctedTitle?: string;
  /** Set when the student edited the generated description. */
  correctedDescription?: string;
  condition: CopyCondition;
  askPriceCents: number | null;
  notes: string | null;
}

/**
 * The second tap: write the book (if it doesn't already exist) and the copy.
 * A title correction is written back to the cache as a human override before
 * anything else happens, so the correction is what gets used everywhere,
 * including here.
 */
export async function createCopyListing(
  input: CreateCopyInput,
): Promise<{ copyId: string } | { error: string }> {
  const supabase = await supabaseServer();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: 'Sign in first.' };

  let record = input.draft;

  if (input.correctedTitle && input.correctedTitle.trim() && input.correctedTitle.trim() !== input.draft.title) {
    const corrected = await applyHumanOverride({
      rawInput: input.draft.rawInput,
      current: {
        title: input.draft.title,
        authors: input.draft.authors,
        edition: input.draft.edition,
        editionNumber: input.draft.editionNumber,
        subjectTags: input.draft.subjectTags,
        conditionGuess: input.draft.conditionGuess,
        isbn13: null,
        canonicalKey: input.draft.canonicalKey,
        workKey: input.draft.workKey,
      },
      correction: { title: input.correctedTitle.trim() },
      userId: user.id,
      cache: supabaseCache(supabase),
    });
    record = { ...record, title: corrected.record.title, canonicalKey: corrected.record.canonicalKey, workKey: corrected.record.workKey };
  }

  // The book row: insert, and on conflict do nothing — an UPDATE would be
  // blocked by RLS for a book somebody else created, and that's fine, we only
  // wanted the row to exist.
  const { error: insertBookError } = await supabase.from('books').upsert(
    {
      canonical_key: record.canonicalKey,
      work_key: record.workKey,
      title: record.title,
      authors: record.authors,
      edition_number: record.editionNumber,
      edition_label: record.edition,
      subject_tags: record.subjectTags,
      source: record.source === 'human' ? 'human' : record.source === 'fallback' ? 'fallback' : 'gemini',
      created_by: user.id,
    },
    { onConflict: 'canonical_key', ignoreDuplicates: true },
  );
  if (insertBookError) return { error: insertBookError.message };

  const { data: book, error: bookLookupError } = await supabase
    .from('books')
    .select('id')
    .eq('canonical_key', record.canonicalKey)
    .single();
  if (bookLookupError || !book) return { error: 'Could not resolve the book record.' };

  const description = input.correctedDescription?.trim() || input.draft.description;

  const { data: copy, error: copyError } = await supabase
    .from('copies')
    .insert({
      owner_id: user.id,
      book_id: book.id,
      condition: input.condition,
      ask_price_cents: input.askPriceCents,
      notes: input.notes,
      description,
      raw_input: input.draft.rawInput,
      input_hash: hashInput(input.draft.rawInput),
      status: 'open',
    })
    .select('id')
    .single();
  if (copyError || !copy) return { error: copyError?.message ?? 'Could not list the copy.' };

  revalidatePath('/shelf');
  revalidatePath('/browse');
  revalidatePath('/matches');

  return { copyId: copy.id };
}

export async function withdrawCopy(copyId: string): Promise<{ error: string } | { ok: true }> {
  const supabase = await supabaseServer();
  const { error } = await supabase.from('copies').update({ status: 'withdrawn' }).eq('id', copyId);
  if (error) return { error: error.message };

  revalidatePath('/shelf');
  revalidatePath('/browse');
  revalidatePath('/matches');
  return { ok: true };
}

export async function relistCopy(copyId: string): Promise<{ error: string } | { ok: true }> {
  const supabase = await supabaseServer();
  const { error } = await supabase.from('copies').update({ status: 'open' }).eq('id', copyId);
  if (error) return { error: error.message };

  revalidatePath('/shelf');
  revalidatePath('/browse');
  revalidatePath('/matches');
  return { ok: true };
}
