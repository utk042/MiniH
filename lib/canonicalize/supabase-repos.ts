import type { SupabaseClient } from '@supabase/supabase-js';
import type {
  BookCatalogue,
  CacheEntry,
  CanonicalizationCache,
  CatalogueMatch,
  CatalogueQuery,
} from './ports';
import type { CanonicalBook } from './schema';

/**
 * Supabase implementations of the two ports.
 *
 * Both run under the signed-in student's own session, not the service role:
 * public.cache_canonicalization and public.books are readable and insertable by
 * `authenticated` on purpose, so the pipeline needs no elevated key at all.
 */

export function supabaseCache(client: SupabaseClient): CanonicalizationCache {
  return {
    async get(inputHash) {
      const { data, error } = await client
        .from('cache_canonicalization')
        .select('input_hash, raw_input, normalized_input, result, canonical_key, model, source, overridden_by')
        .eq('input_hash', inputHash)
        .maybeSingle();

      if (error || !data) return null;

      return {
        inputHash: data.input_hash,
        rawInput: data.raw_input,
        normalizedInput: data.normalized_input,
        record: recordFromJson(data.result),
        canonicalKey: data.canonical_key,
        model: data.model,
        source: data.source,
        overriddenBy: data.overridden_by,
      };
    },

    async put(entry: CacheEntry) {
      const { error } = await client.from('cache_canonicalization').upsert(
        {
          input_hash: entry.inputHash,
          raw_input: entry.rawInput,
          normalized_input: entry.normalizedInput,
          result: recordToJson(entry.record),
          canonical_key: entry.canonicalKey,
          model: entry.model,
          source: entry.source,
          overridden_by: entry.overriddenBy ?? null,
        },
        { onConflict: 'input_hash' },
      );

      // A human correction already in the row makes the trigger reject this.
      // That is the intended outcome, not an error worth propagating.
      if (error && !/corrected by hand/i.test(error.message)) throw error;
    },

    async bumpHit(inputHash) {
      await client.rpc('bump_canonicalization_hit', { p_input_hash: inputHash });
    },
  };
}

export function supabaseCatalogue(client: SupabaseClient): BookCatalogue {
  return {
    async find(query: CatalogueQuery): Promise<CatalogueMatch | null> {
      const { data, error } = await client.rpc('resolve_book', {
        p_title_key: query.titleKey,
        p_edition_number: query.editionNumber,
        p_surnames: query.surnames,
        p_isbn13: query.isbn13,
      });

      if (error || !data || (Array.isArray(data) && data.length === 0)) return null;
      const row = Array.isArray(data) ? data[0] : data;

      return {
        canonicalKey: row.canonical_key,
        workKey: row.work_key,
        title: row.title,
        authors: row.authors ?? [],
        editionNumber: row.edition_number,
        editionLabel: row.edition_label,
        subjectTags: row.subject_tags ?? [],
        courseCodes: row.course_codes ?? [],
      };
    },
  };
}

/** The shape stored in cache_canonicalization.result, in snake_case like the DB. */
export function recordToJson(record: CanonicalBook): Record<string, unknown> {
  return {
    title: record.title,
    authors: record.authors,
    edition: record.edition,
    edition_number: record.editionNumber,
    subject_tags: record.subjectTags,
    condition_guess: record.conditionGuess,
    isbn13: record.isbn13,
    canonical_key: record.canonicalKey,
    work_key: record.workKey,
  };
}

export function recordFromJson(json: unknown): CanonicalBook {
  const row = (json ?? {}) as Record<string, unknown>;
  return {
    title: String(row.title ?? ''),
    authors: Array.isArray(row.authors) ? row.authors.map(String) : [],
    edition: (row.edition as string | null) ?? null,
    editionNumber: (row.edition_number as number | null) ?? null,
    subjectTags: Array.isArray(row.subject_tags) ? row.subject_tags.map(String) : [],
    conditionGuess: (row.condition_guess as CanonicalBook['conditionGuess']) ?? null,
    isbn13: (row.isbn13 as string | null) ?? null,
    canonicalKey: String(row.canonical_key ?? ''),
    workKey: String(row.work_key ?? ''),
  };
}
