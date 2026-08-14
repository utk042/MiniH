/**
 * The controlled tag vocabulary.
 *
 * Tags are a filter, not decoration, so they have to be drawn from a list
 * everyone shares — "orgo", "organic chem" and "Organic Chemistry" must not
 * become three different facets. The model may add a small number of free tags
 * beyond this list, capped, for the things a fixed vocabulary cannot anticipate.
 *
 * This file is the source of truth. Migration 20260814000700 seeds the same
 * terms into public.tag_vocabulary, and a test asserts the two agree.
 */

export const TAG_FACETS = ['subject', 'topic', 'level', 'format', 'exam'] as const;
export type TagFacet = (typeof TAG_FACETS)[number];

export const TAG_VOCABULARY: Readonly<Record<TagFacet, readonly string[]>> = {
  subject: [
    'anatomy', 'anthropology', 'art-history', 'biochemistry', 'biology',
    'business', 'chemistry', 'computer-science', 'economics', 'engineering',
    'finance', 'history', 'law', 'linguistics', 'literature', 'mathematics',
    'music', 'neuroscience', 'philosophy', 'physics', 'physiology',
    'political-science', 'psychology', 'sociology', 'statistics', 'writing',
  ],
  topic: [
    'algorithms', 'american-history', 'american-literature', 'ancient-philosophy',
    'artificial-intelligence', 'calculus', 'cell-biology', 'corporate-finance',
    'derivatives', 'dynamical-systems', 'econometrics', 'electromagnetism',
    'english-literature', 'genetics', 'international', 'linear-algebra',
    'marketing', 'mechanics', 'metaphysics', 'microeconomics', 'networks',
    'organic-chemistry', 'physical-chemistry', 'political-theory',
    'probability', 'quantum-mechanics', 'real-analysis', 'shakespeare',
    'systems', 'theory', 'twentieth-century', 'world-history',
  ],
  level: ['intro-level', 'upper-division', 'grad-level'],
  format: [
    'anthology', 'annotated', 'access-code-required', 'edition-sensitive',
    'ex-library', 'hardcover', 'international-edition', 'lab-required',
    'loose-leaf', 'open-access', 'paperback', 'solutions-manual',
    'workbook-included', 'required-all-majors',
  ],
  exam: ['exam-prep', 'mcat-prep', 'lsat-prep', 'gre-prep', 'interview-prep'],
};

export const CONTROLLED_TAGS: readonly string[] = Object.values(TAG_VOCABULARY)
  .flat()
  .sort();

const CONTROLLED_TAG_SET = new Set(CONTROLLED_TAGS);

export function isControlledTag(tag: string): boolean {
  return CONTROLLED_TAG_SET.has(tag);
}

export function facetOf(tag: string): TagFacet | null {
  for (const facet of TAG_FACETS) {
    if (TAG_VOCABULARY[facet].includes(tag)) return facet;
  }
  return null;
}

export const TAG_RULES = {
  min: 4,
  max: 8,
  /** At least this many must come from the controlled list. */
  minControlled: 2,
  /** Anything beyond the controlled list, capped so the vocabulary still means something. */
  maxFree: 3,
  freeTagPattern: /^[a-z0-9]+(-[a-z0-9]+)*$/,
  maxFreeTagLength: 28,
} as const;
