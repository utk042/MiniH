import { GEMINI_LIMITS, GEMINI_MODEL } from '../ai/model';
import { generateJson, GeminiUnavailableError, parseJsonLoosely, type GenerateJson } from '../ai/gemini';
import { canonicalizeByRules, guessCondition } from './fallback';
import { assertUsableInput, hashInput, normalizeInput } from './normalize';
import { emptyCatalogue, noCache, type BookCatalogue, type CanonicalizationCache } from './ports';
import { canonicalizationPrompt } from './prompts';
import {
  CANONICALIZATION_RESPONSE_SCHEMA,
  CanonicalizationOutput,
  type CanonicalBook,
  type CanonicalizationResult,
} from './schema';
import { deriveKeys, editionLabel, isSlug, parseEditionNumber, surnameOf, titleKey } from './slug';

export interface CanonicalizeOptions {
  cache?: CanonicalizationCache;
  catalogue?: BookCatalogue;
  /** Injected in tests. Defaults to the real Gemini transport. */
  generate?: GenerateJson;
  signal?: AbortSignal;
}

/**
 * Free text in, one canonical record out.
 *
 *   1. normalise and hash the input
 *   2. cache hit?                       -> return, zero API calls
 *   3. ask Gemini for the fields
 *   4. validate with Zod; on any failure, fall back to rules
 *   5. resolve against the existing catalogue, so a book already on campus
 *      keeps the key it already has
 *   6. otherwise derive the key deterministically in code
 *   7. write the cache
 *
 * Step 4 is the reason nothing here throws on a bad model response, and step 6
 * is the reason the model never gets to decide a canonical_key.
 */
export async function canonicalize(
  rawInput: string,
  options: CanonicalizeOptions = {},
): Promise<CanonicalizationResult> {
  const {
    cache = noCache,
    catalogue = emptyCatalogue,
    generate = generateJson,
    signal,
  } = options;

  const input = assertUsableInput(rawInput);
  const normalizedInput = normalizeInput(input);
  const inputHash = hashInput(input);

  // --- 2. cache -------------------------------------------------------------
  const cached = await cache.get(inputHash).catch(() => null);
  if (cached) {
    void cache.bumpHit(inputHash).catch(() => {});
    return {
      record: cached.record,
      // A human correction stays labelled as one; it is not "the cache".
      source: cached.source === 'human' ? 'human' : 'cache',
      matchedExistingBook: false,
      model: cached.model || null,
      inputHash,
      normalizedInput,
      warnings: [],
    };
  }

  // --- 3/4. model, then validation -----------------------------------------
  return singleFlight(inputHash, async () => {
    const warnings: string[] = [];
    let record: CanonicalBook;
    let source: 'gemini' | 'fallback';
    let model: string | null = null;

    try {
      const response = await generate({
        prompt: canonicalizationPrompt(input),
        schema: CANONICALIZATION_RESPONSE_SCHEMA,
        maxOutputTokens: GEMINI_LIMITS.canonicalizeMaxOutputTokens,
        signal,
      });

      const parsed = CanonicalizationOutput.safeParse(parseJsonLoosely(response.text));
      if (!parsed.success) {
        throw new GeminiUnavailableError(
          `Response failed validation: ${parsed.error.issues.map((i) => `${i.path.join('.')} ${i.message}`).join('; ')}`,
        );
      }

      record = fromModelOutput(parsed.data, input, warnings);
      source = 'gemini';
      model = response.model || GEMINI_MODEL;
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      const fallback = canonicalizeByRules(input);
      record = fallback.record;
      source = 'fallback';
      warnings.push(...fallback.warnings);
      warnings.push(`Model unavailable: ${reason}`);
    }

    // --- 5. reuse a key the campus already agreed on -------------------------
    const existing = await catalogue
      .find({
        titleKey: titleKey(record.title),
        editionNumber: record.editionNumber,
        surnames: record.authors.map(surnameOf).filter(Boolean),
        isbn13: record.isbn13,
      })
      .catch(() => null);

    let matchedExistingBook = false;
    if (existing) {
      matchedExistingBook = true;
      record = {
        ...record,
        title: existing.title,
        authors: record.authors.length ? record.authors : existing.authors,
        edition: record.edition ?? existing.editionLabel,
        editionNumber: record.editionNumber ?? existing.editionNumber,
        subjectTags: existing.subjectTags.length ? existing.subjectTags : record.subjectTags,
        canonicalKey: existing.canonicalKey,
        workKey: existing.workKey,
      };
    }

    // --- 7. cache -------------------------------------------------------------
    await cache
      .put({
        inputHash,
        rawInput: input,
        normalizedInput,
        record,
        canonicalKey: record.canonicalKey,
        model: model ?? '',
        source,
      })
      .catch(() => {
        warnings.push('Could not write the canonicalization cache.');
      });

    return { record, source, matchedExistingBook, model, inputHash, normalizedInput, warnings };
  });
}

/**
 * Turns a validated model response into the record we keep. The model's
 * canonical_key is compared against the derived one and then discarded: only
 * the derived key is ever written.
 */
function fromModelOutput(
  output: CanonicalizationOutput,
  rawInput: string,
  warnings: string[],
): CanonicalBook {
  const authors = output.authors.map((a) => a.trim()).filter(Boolean);

  // The model is told to return null when the edition is not stated. If it did
  // and the text plainly says "3rd ed", prefer the text.
  const editionNumber = output.edition_number ?? parseEditionNumber(rawInput);

  const { workKey, canonicalKey } = deriveKeys({ title: output.title, authors, editionNumber });

  if (output.canonical_key && output.canonical_key !== canonicalKey) {
    warnings.push(
      `Model proposed ${output.canonical_key}; using the derived key ${canonicalKey}.`,
    );
  }
  if (output.canonical_key && !isSlug(output.canonical_key)) {
    warnings.push('Model returned a key that is not a slug.');
  }

  return {
    title: output.title.trim(),
    authors,
    edition: output.edition?.trim() || editionLabel(editionNumber),
    editionNumber,
    subjectTags: [...new Set(output.subject_tags)].slice(0, 8),
    conditionGuess: output.condition_guess ?? guessCondition(rawInput),
    isbn13: output.isbn13,
    canonicalKey,
    workKey,
  };
}

/**
 * Two people pasting the same string at the same moment is one API call, not
 * two. The map is per-process, which is the right scope: it collapses the
 * duplicate burst, and the Supabase cache handles everything after that.
 */
const inFlight = new Map<string, Promise<CanonicalizationResult>>();

function singleFlight(
  key: string,
  work: () => Promise<CanonicalizationResult>,
): Promise<CanonicalizationResult> {
  const running = inFlight.get(key);
  if (running) return running;

  const promise = work().finally(() => inFlight.delete(key));
  inFlight.set(key, promise);
  return promise;
}

/** Test seam: the in-flight map is process-global and outlives a single test. */
export function _resetInFlight(): void {
  inFlight.clear();
}
