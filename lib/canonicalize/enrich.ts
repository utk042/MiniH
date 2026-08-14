import { GEMINI_LIMITS, GEMINI_MODEL } from '../ai/model';
import { generateJson, GeminiUnavailableError, parseJsonLoosely, type GenerateJson } from '../ai/gemini';
import { courseLevel, describeByRules, tagsByRules } from './fallback';
import { hashStructured } from './normalize';
import { enrichmentPrompt, type EnrichmentInput } from './prompts';
import { ENRICHMENT_RESPONSE_SCHEMA, EnrichmentOutput } from './schema';
import { isControlledTag, TAG_RULES } from '../tags/vocabulary';

/**
 * Tags and description come back in ONE call. They are written from the same
 * structured record, and two calls would double the cost for nothing.
 *
 * Both outputs are validated against house rules afterwards, not just against a
 * shape: a description that reads like a product page is a failed response even
 * though it is a perfectly good string.
 */

export interface EnrichmentResult {
  tags: string[];
  description: string;
  source: 'gemini' | 'fallback';
  model: string | null;
  /** Stable hash of the input record; the caller may use it as a cache key. */
  inputHash: string;
  warnings: string[];
}

export interface EnrichOptions {
  generate?: GenerateJson;
  signal?: AbortSignal;
}

export interface EnrichSubject extends EnrichmentInput {
  editionNumber: number | null;
}

export async function enrich(
  book: EnrichSubject,
  options: EnrichOptions = {},
): Promise<EnrichmentResult> {
  const { generate = generateJson, signal } = options;
  const inputHash = hashStructured(book);
  const warnings: string[] = [];

  try {
    const response = await generate({
      prompt: enrichmentPrompt(book),
      schema: ENRICHMENT_RESPONSE_SCHEMA,
      maxOutputTokens: GEMINI_LIMITS.enrichMaxOutputTokens,
      signal,
    });

    const parsed = EnrichmentOutput.safeParse(parseJsonLoosely(response.text));
    if (!parsed.success) {
      throw new GeminiUnavailableError(
        parsed.error.issues.map((i) => `${i.path.join('.')} ${i.message}`).join('; '),
      );
    }

    const tags = normalizeTags(parsed.data.tags, book);
    const tagProblem = validateTags(tags);
    if (tagProblem) throw new GeminiUnavailableError(tagProblem);

    const description = parsed.data.description.trim();
    const descriptionProblem = validateDescription(description);
    if (descriptionProblem) throw new GeminiUnavailableError(descriptionProblem);

    return {
      tags,
      description,
      source: 'gemini',
      model: response.model || GEMINI_MODEL,
      inputHash,
      warnings,
    };
  } catch (error) {
    warnings.push(
      `Written without the model: ${error instanceof Error ? error.message : String(error)}`,
    );
    return {
      tags: fallbackTags(book),
      description: describeByRules({
        title: book.title,
        authors: book.authors,
        edition: book.edition,
        condition: book.condition,
        notes: book.notes,
        courseCodes: book.courseCodes,
      }),
      source: 'fallback',
      model: null,
      inputHash,
      warnings,
    };
  }
}

/**
 * Trim to the house rules: lowercase, deduplicate, controlled tags first, free
 * tags capped. A model that returns fifteen tags gets the best eight rather
 * than a rejection.
 */
export function normalizeTags(raw: string[], book: EnrichSubject): string[] {
  const seen = new Set<string>();
  const controlled: string[] = [];
  const free: string[] = [];

  for (const candidate of raw) {
    const tag = candidate.trim().toLowerCase();
    if (!tag || seen.has(tag)) continue;
    if (!TAG_RULES.freeTagPattern.test(tag)) continue;
    if (tag.length > TAG_RULES.maxFreeTagLength) continue;
    seen.add(tag);
    (isControlledTag(tag) ? controlled : free).push(tag);
  }

  // Top up from what we already know before giving up on the minimum.
  for (const tag of fallbackTags(book)) {
    if (controlled.length + free.length >= TAG_RULES.min) break;
    if (seen.has(tag)) continue;
    seen.add(tag);
    (isControlledTag(tag) ? controlled : free).push(tag);
  }

  return [...controlled, ...free.slice(0, TAG_RULES.maxFree)].slice(0, TAG_RULES.max);
}

export function validateTags(tags: string[]): string | null {
  if (tags.length < TAG_RULES.min) return `only ${tags.length} usable tags`;
  if (tags.length > TAG_RULES.max) return `${tags.length} tags is over the cap`;
  const controlled = tags.filter(isControlledTag).length;
  if (controlled < TAG_RULES.minControlled) {
    return `only ${controlled} tags from the controlled vocabulary`;
  }
  return null;
}

/** Phrases that mean the prompt failed, whatever the sentence around them says. */
const MARKETING = [
  'elevate', 'seamless', 'effortless', 'revolutionis', 'revolutioniz', 'unlock',
  'dive into', 'game-chang', 'must-have', 'must have', 'look no further',
  'perfect for', 'ideal for', 'you will love', "you'll love", 'grab it',
  'don’t miss', "don't miss", 'hurry', 'a steal', 'bargain', 'amazing',
  'incredible', 'stunning', 'transform your', 'take your', 'level up',
];

const EMOJI = /\p{Extended_Pictographic}/u;

/**
 * Abbreviations and initials whose full stop does not end a sentence. Without
 * this, "Morrison and Boyd, 3rd ed." counts as two sentences and every honest
 * description gets rejected.
 */
const NOT_A_SENTENCE_END =
  /\b(?:ed|edn|eds|vol|vols|no|nos|pp|p|al|rev|repr|approx|ca|cf|e\.g|i\.e|jr|sr|dr|mr|mrs|ms|prof|st)\.|\b\p{Lu}\./giu;

export function countSentences(text: string): number {
  const masked = text.replace(NOT_A_SENTENCE_END, '§');
  return masked
    .split(/(?<=[.?])\s+/)
    .map((s) => s.trim())
    .filter(Boolean).length;
}

export function validateDescription(description: string): string | null {
  if (!description) return 'empty description';
  if (description.length > 320) return 'description runs past two sentences of length';
  if (description.includes('!')) return 'exclamation mark';
  if (EMOJI.test(description)) return 'emoji';

  const sentences = countSentences(description);
  if (sentences > 2) return `${sentences} sentences`;

  const lower = description.toLowerCase();
  const offender = MARKETING.find((phrase) => lower.includes(phrase));
  if (offender) return `marketing language: "${offender}"`;

  // Second person is how sales copy sneaks back in.
  if (/\byou(r|rs)?\b/i.test(description)) return 'addresses the reader directly';

  return null;
}

function fallbackTags(book: EnrichSubject): string[] {
  const tags = tagsByRules({
    subjectTags: book.subjectTags,
    editionNumber: book.editionNumber,
    courseCodes: book.courseCodes,
  });

  const level = book.courseCodes.map(courseLevel).find(Boolean);
  if (level && !tags.includes(level)) tags.push(level);

  return tags.slice(0, TAG_RULES.max);
}
