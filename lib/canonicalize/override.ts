import { hashInput, normalizeInput } from './normalize';
import type { CanonicalizationCache } from './ports';
import type { CanonicalBook, CanonicalizationResult } from './schema';
import { deriveKeys, editionLabel } from './slug';

/**
 * A student correcting what the model got wrong.
 *
 * The correction is written back to the cache under the same input hash and
 * marked 'human', so the next person who types the same thing gets the
 * corrected record and no API call. A trigger in migration 000400 stops
 * automated output from overwriting it afterwards.
 */

export interface Correction {
  title?: string;
  authors?: string[];
  editionNumber?: number | null;
  edition?: string | null;
  subjectTags?: string[];
  isbn13?: string | null;
  /** Set when the student picks an existing book instead of editing fields. */
  canonicalKey?: string;
  workKey?: string;
}

export interface ApplyCorrectionArgs {
  rawInput: string;
  current: CanonicalBook;
  correction: Correction;
  userId: string;
  cache: CanonicalizationCache;
}

export async function applyHumanOverride({
  rawInput,
  current,
  correction,
  userId,
  cache,
}: ApplyCorrectionArgs): Promise<CanonicalizationResult> {
  const title = correction.title?.trim() || current.title;
  const authors = correction.authors ?? current.authors;
  const editionNumber =
    correction.editionNumber === undefined ? current.editionNumber : correction.editionNumber;

  // Picking an existing book wins over re-deriving: the student is telling us
  // which node they mean, and that is exactly the decision we want from them.
  const keys =
    correction.canonicalKey && correction.workKey
      ? { canonicalKey: correction.canonicalKey, workKey: correction.workKey }
      : deriveKeys({ title, authors, editionNumber });

  const record: CanonicalBook = {
    title,
    authors,
    edition:
      correction.edition === undefined
        ? (current.edition ?? editionLabel(editionNumber))
        : correction.edition,
    editionNumber,
    subjectTags: correction.subjectTags ?? current.subjectTags,
    conditionGuess: current.conditionGuess,
    isbn13: correction.isbn13 === undefined ? current.isbn13 : correction.isbn13,
    canonicalKey: keys.canonicalKey,
    workKey: keys.workKey,
  };

  const inputHash = hashInput(rawInput);
  const normalizedInput = normalizeInput(rawInput);

  await cache.put({
    inputHash,
    rawInput,
    normalizedInput,
    record,
    canonicalKey: record.canonicalKey,
    model: '',
    source: 'human',
    overriddenBy: userId,
  });

  return {
    record,
    source: 'human',
    matchedExistingBook: Boolean(correction.canonicalKey),
    model: null,
    inputHash,
    normalizedInput,
    warnings: [],
  };
}
