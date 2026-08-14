'use server';

import { revalidatePath } from 'next/cache';
import { canonicalize } from '../../lib/canonicalize/canonicalize';
import { applyHumanOverride } from '../../lib/canonicalize/override';
import { supabaseCache, supabaseCatalogue } from '../../lib/canonicalize/supabase-repos';
import { supabaseServer } from '../../lib/supabase/server';

export interface ResolvedWantDraft {
  rawInput: string;
  title: string;
  authors: string[];
  edition: string | null;
  canonicalKey: string;
  workKey: string;
  source: 'cache' | 'gemini' | 'fallback' | 'human';
  matchedExistingBook: boolean;
  warnings: string[];
}

/** No enrichment here — tags and a sales description are for a listing, not a want. */
export async function resolveWantDraft(rawInput: string): Promise<{ draft: ResolvedWantDraft } | { error: string }> {
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

    return {
      draft: {
        rawInput,
        title: result.record.title,
        authors: result.record.authors,
        edition: result.record.edition,
        canonicalKey: result.record.canonicalKey,
        workKey: result.record.workKey,
        source: result.source,
        matchedExistingBook: result.matchedExistingBook,
        warnings: result.warnings,
      },
    };
  } catch (error) {
    return { error: error instanceof Error ? error.message : 'Could not read that. Try the title, author and edition.' };
  }
}

export interface CreateWantInput {
  draft: ResolvedWantDraft;
  correctedTitle?: string;
  priority: number;
  editionStrict: boolean;
  note: string | null;
}

export async function createWant(input: CreateWantInput): Promise<{ wantId: string } | { error: string }> {
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
        editionNumber: null,
        subjectTags: [],
        conditionGuess: null,
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

  const { error: insertBookError } = await supabase.from('books').upsert(
    {
      canonical_key: record.canonicalKey,
      work_key: record.workKey,
      title: record.title,
      authors: record.authors,
      edition_label: record.edition,
      source: record.source === 'human' ? 'human' : record.source === 'fallback' ? 'fallback' : 'gemini',
      created_by: user.id,
    },
    { onConflict: 'canonical_key', ignoreDuplicates: true },
  );
  if (insertBookError) return { error: insertBookError.message };

  const { data: want, error: wantError } = await supabase
    .from('wants')
    .upsert(
      {
        user_id: user.id,
        canonical_key: record.canonicalKey,
        priority: input.priority,
        edition_strict: input.editionStrict,
        note: input.note,
        status: 'active',
      },
      { onConflict: 'user_id,canonical_key' },
    )
    .select('id')
    .single();
  if (wantError || !want) return { error: wantError?.message ?? 'Could not add the want.' };

  revalidatePath('/wants');
  revalidatePath('/matches');

  return { wantId: want.id };
}

export async function archiveWant(wantId: string): Promise<{ error: string } | { ok: true }> {
  const supabase = await supabaseServer();
  const { error } = await supabase.from('wants').update({ status: 'archived' }).eq('id', wantId);
  if (error) return { error: error.message };

  revalidatePath('/wants');
  revalidatePath('/matches');
  return { ok: true };
}

export async function reactivateWant(wantId: string): Promise<{ error: string } | { ok: true }> {
  const supabase = await supabaseServer();
  const { error } = await supabase.from('wants').update({ status: 'active' }).eq('id', wantId);
  if (error) return { error: error.message };

  revalidatePath('/wants');
  revalidatePath('/matches');
  return { ok: true };
}
