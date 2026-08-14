import { z } from 'zod';
import { SLUG_PATTERN } from './slug';
import { TAG_RULES } from '../tags/vocabulary';

/**
 * Two contracts live here:
 *
 *   *ResponseSchema  what Gemini is told to produce (responseSchema, so the
 *                    API constrains decoding rather than us hoping)
 *   *Output          what we will accept afterwards (Zod, because the API
 *                    constraint is not a guarantee and a bad record is worse
 *                    than no record)
 *
 * They deliberately overlap. The API-side schema keeps the response cheap and
 * well-formed; the Zod schema is what actually gates the write.
 */

const CONDITIONS = ['poor', 'fair', 'good', 'like_new', 'new'] as const;
export type ConditionGuess = (typeof CONDITIONS)[number];

// --- canonicalization -------------------------------------------------------

export const CanonicalizationOutput = z.object({
  title: z.string().trim().min(1).max(300),
  authors: z.array(z.string().trim().min(1).max(120)).max(8).default([]),
  edition: z.string().trim().max(60).nullable().default(null),
  edition_number: z.number().int().min(1).max(60).nullable().default(null),
  subject_tags: z
    .array(z.string().trim().regex(SLUG_PATTERN).max(40))
    .max(8)
    .default([]),
  condition_guess: z.enum(CONDITIONS).nullable().default(null),
  isbn13: z
    .string()
    .regex(/^\d{13}$/)
    .nullable()
    .default(null),
  // Asked for, then cross-checked. lib/canonicalize/slug.ts has the last word.
  canonical_key: z.string().trim().max(140).nullable().default(null),
  work_key: z.string().trim().max(140).nullable().default(null),
});

export type CanonicalizationOutput = z.infer<typeof CanonicalizationOutput>;

/** Gemini responseSchema. Uppercase type names are what the API expects. */
export const CANONICALIZATION_RESPONSE_SCHEMA = {
  type: 'OBJECT',
  properties: {
    title: { type: 'STRING', description: 'Full book title, properly capitalised, no edition or condition text.' },
    authors: { type: 'ARRAY', items: { type: 'STRING' }, description: 'Author names as printed, "Given Surname".' },
    edition: { type: 'STRING', nullable: true, description: 'Edition as printed, e.g. "3rd ed.". Null if not stated.' },
    edition_number: { type: 'INTEGER', nullable: true, description: 'The edition as a number. Null if not stated.' },
    subject_tags: { type: 'ARRAY', items: { type: 'STRING' }, description: 'Up to 5 lowercase hyphenated subject slugs.' },
    condition_guess: { type: 'STRING', nullable: true, enum: [...CONDITIONS], description: 'Only if the text describes condition.' },
    isbn13: { type: 'STRING', nullable: true, description: '13 digits, no hyphens. Null unless an ISBN appears in the text.' },
    canonical_key: { type: 'STRING', nullable: true, description: 'Lowercase slug: surname(s), title, edition number.' },
    work_key: { type: 'STRING', nullable: true, description: 'The canonical_key without the trailing edition number.' },
  },
  required: ['title', 'authors', 'edition', 'edition_number', 'subject_tags', 'condition_guess', 'isbn13', 'canonical_key', 'work_key'],
  propertyOrdering: ['title', 'authors', 'edition', 'edition_number', 'subject_tags', 'condition_guess', 'isbn13', 'canonical_key', 'work_key'],
} as const;

// --- tags + description (one call, not two) ---------------------------------

export const EnrichmentOutput = z.object({
  tags: z
    .array(z.string().trim().toLowerCase().regex(TAG_RULES.freeTagPattern).max(TAG_RULES.maxFreeTagLength))
    .min(1)
    .max(16),
  description: z.string().trim().min(1).max(400),
});

export type EnrichmentOutput = z.infer<typeof EnrichmentOutput>;

export const ENRICHMENT_RESPONSE_SCHEMA = {
  type: 'OBJECT',
  properties: {
    tags: { type: 'ARRAY', items: { type: 'STRING' }, description: '4 to 8 lowercase hyphenated tags.' },
    description: { type: 'STRING', description: 'At most two plain factual sentences.' },
  },
  required: ['tags', 'description'],
  propertyOrdering: ['tags', 'description'],
} as const;

// --- the record the rest of the app uses ------------------------------------

export interface CanonicalBook {
  title: string;
  authors: string[];
  edition: string | null;
  editionNumber: number | null;
  subjectTags: string[];
  conditionGuess: ConditionGuess | null;
  isbn13: string | null;
  canonicalKey: string;
  workKey: string;
}

/** How a record was arrived at. Mirrors the canon_source enum in Postgres. */
export type CanonicalizationSource = 'cache' | 'gemini' | 'fallback' | 'human';

export interface CanonicalizationResult {
  record: CanonicalBook;
  source: CanonicalizationSource;
  /** True when the record was matched onto a book already in the catalogue. */
  matchedExistingBook: boolean;
  /** Null when no model was called. */
  model: string | null;
  inputHash: string;
  normalizedInput: string;
  /** Non-fatal problems worth surfacing next to the "resolved by AI" affordance. */
  warnings: string[];
}
