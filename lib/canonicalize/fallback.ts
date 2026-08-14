import type { CanonicalBook, ConditionGuess } from './schema';
import { deriveKeys, editionLabel, parseEditionNumber, parseIsbn13, slugify } from './slug';

/**
 * The rules-based path. Used whenever the model is unavailable, slow, or
 * returns something that fails validation — the listing flow never stops
 * because an API did.
 *
 * It is worse than the model and does not pretend otherwise: it does not expand
 * "orgo", it cannot spell an author it has never seen, and the record it
 * produces is flagged so the UI can ask the student to check it. It is,
 * however, deterministic and always available.
 */

const CONDITION_HINTS: ReadonlyArray<[RegExp, ConditionGuess]> = [
  [/\b(brand new|unopened|never opened|never used|sealed|unread)\b/, 'new'],
  [/\b(like new|as new|mint|barely (used|opened)|read once|pristine|unmarked)\b/, 'like_new'],
  [/\b(water damage|waterlogged|mold|missing pages|torn out|falling apart|no cover|chewed|ruined)\b/, 'poor'],
  [/\b(heavily (highlighted|marked)|cover detached|loose (cover|pages|binding)|taped|ex-library|writing throughout|coffee)\b/, 'fair'],
  [/\b(spine cracked|dog-?eared|creased|scuffed|worn|some (highlighting|underlining|pencil|notes)|used|good condition)\b/, 'good'],
];

/** Words that describe the copy, not the book, and must not reach the title. */
const CONDITION_NOISE = new RegExp(
  [
    'brand new', 'never opened', 'never used', 'like new', 'as new', 'no marks', 'no writing',
    'spine cracked', 'water damage', 'ex-?library', 'dog-?eared', 'loose leaf', 'loose-leaf',
    'hardcover', 'hardback', 'paperback', 'highlighted', 'highlighting', 'hilighted',
    'underlined', 'underlining', 'annotated', 'unmarked', 'unread', 'mint', 'clean copy',
    'good condition', 'fair condition', 'poor condition', 'some wear', 'wear and tear',
    'access code', 'no access code', 'solutions? manual', 'study guide', 'international edition',
    'pdf', 'printout', 'bound', 'taped', 'scuffed', 'creased', 'worn', 'used',
  ].join('|'),
  'gi',
);

/** Common campus shorthand. Kept short on purpose: this is a safety net. */
const SHORTHAND: ReadonlyArray<[RegExp, string]> = [
  [/\borgo\b/gi, 'organic chemistry'],
  [/\bcalc\b/gi, 'calculus'],
  [/\bbio\b/gi, 'biology'],
  [/\bchem\b/gi, 'chemistry'],
  [/\bphys\b/gi, 'physics'],
  [/\becon\b/gi, 'economics'],
  [/\bpsych\b/gi, 'psychology'],
  [/\bstats?\b/gi, 'statistics'],
  [/\bling\b/gi, 'linguistics'],
  [/\banthro\b/gi, 'anthropology'],
  [/\bphilo?\b/gi, 'philosophy'],
  [/\blit\b/gi, 'literature'],
  [/\banat\b/gi, 'anatomy'],
  [/\bneuro\b/gi, 'neuroscience'],
  [/\bbiochem\b/gi, 'biochemistry'],
  [/\bmicro\b/gi, 'microeconomics'],
  [/\bmacro\b/gi, 'macroeconomics'],
  [/\bintro\b/gi, 'introduction'],
  [/\bprinc\b/gi, 'principles'],
  [/\buniv\b/gi, 'university'],
  [/\bvol\b/gi, 'volume'],
  [/\banthol\b/gi, 'anthology'],
  [/\bamer\b/gi, 'american'],
  [/\be&m\b/gi, 'electrodynamics'],
];

const SUBJECT_HINTS: ReadonlyArray<[RegExp, string]> = [
  [/organic chemistry/i, 'organic-chemistry'],
  [/physical chemistry/i, 'physical-chemistry'],
  [/chemistry/i, 'chemistry'],
  [/biochemistry/i, 'biochemistry'],
  [/biology/i, 'biology'],
  [/neuroscience/i, 'neuroscience'],
  [/anatomy/i, 'anatomy'],
  [/calculus/i, 'calculus'],
  [/linear algebra/i, 'linear-algebra'],
  [/analysis/i, 'real-analysis'],
  [/probability/i, 'probability'],
  [/statistic/i, 'statistics'],
  [/algorithm/i, 'algorithms'],
  [/electrodynamics|electromagnet/i, 'electromagnetism'],
  [/quantum/i, 'quantum-mechanics'],
  [/mechanics/i, 'mechanics'],
  [/physics/i, 'physics'],
  [/econometric/i, 'econometrics'],
  [/economics/i, 'economics'],
  [/finance|derivatives/i, 'finance'],
  [/psychology/i, 'psychology'],
  [/sociology/i, 'sociology'],
  [/philosophy/i, 'philosophy'],
  [/literature|anthology/i, 'literature'],
  [/history/i, 'history'],
];

export interface FallbackResult {
  record: CanonicalBook;
  warnings: string[];
}

export function canonicalizeByRules(rawInput: string): FallbackResult {
  const warnings: string[] = ['Resolved without the model, from the text as typed.'];

  const isbn13 = parseIsbn13(rawInput);
  const editionNumber = parseEditionNumber(rawInput);

  let working = rawInput;
  if (isbn13) working = working.replace(/[\d-]{13,20}/g, ' ');

  // Everything after the first clause break is usually condition talk. An em
  // or en dash counts; a plain hyphen does not, because titles contain those.
  const [head] = working.split(/[,;(\u2014\u2013]/);
  let titlePart = head ?? working;

  titlePart = titlePart
    .replace(CONDITION_NOISE, ' ')
    // Edition markers, in any of the forms parseEditionNumber understands.
    .replace(/\b\d{1,2}\s*(st|nd|rd|th)?\s*(ed\.?|edn\.?|edition)\b/gi, ' ')
    .replace(/\b(first|second|third|fourth|fifth|sixth|seventh|eighth|ninth|tenth|eleventh|twelfth|thirteenth|fourteenth|fifteenth|sixteenth|seventeenth|eighteenth|nineteenth|twentieth)\s*(ed\.?|edn\.?|edition)\b/gi, ' ')
    .replace(/\b\d{1,2}\s*(st|nd|rd|th)\b/gi, ' ')
    .replace(/\b\d{1,2}e\b/gi, ' ')
    .replace(/[^\p{L}\p{N}&'\s-]+/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  for (const [pattern, expansion] of SHORTHAND) {
    titlePart = titlePart.replace(pattern, expansion);
  }

  if (!titlePart) {
    titlePart = 'Untitled listing';
    warnings.push('No title could be read out of the text.');
  }

  const title = titleCase(titlePart);
  const subjectTags = SUBJECT_HINTS.filter(([pattern]) => pattern.test(titlePart))
    .map(([, tag]) => tag)
    .slice(0, 4);

  // Authors cannot be told apart from title words without a catalogue, so the
  // rules path does not claim any. The keys it mints are title-only and the
  // caller is told as much.
  const { workKey, canonicalKey } = deriveKeys({ title, authors: [], editionNumber });
  warnings.push('No author was identified, so the key is derived from the title alone.');

  return {
    record: {
      title,
      authors: [],
      edition: editionLabel(editionNumber),
      editionNumber,
      subjectTags,
      conditionGuess: guessCondition(rawInput),
      isbn13,
      canonicalKey,
      workKey,
    },
    warnings,
  };
}

export function guessCondition(text: string): ConditionGuess | null {
  const haystack = text.toLowerCase();
  for (const [pattern, condition] of CONDITION_HINTS) {
    if (pattern.test(haystack)) return condition;
  }
  return null;
}

const LOWERCASE_IN_TITLES = new Set([
  'a', 'an', 'and', 'as', 'at', 'but', 'by', 'for', 'from', 'in', 'nor', 'of',
  'on', 'or', 'the', 'to', 'with',
]);

function titleCase(text: string): string {
  const words = text.toLowerCase().split(/\s+/).filter(Boolean);
  return words
    .map((word, index) => {
      if (index > 0 && index < words.length - 1 && LOWERCASE_IN_TITLES.has(word)) return word;
      return word.charAt(0).toUpperCase() + word.slice(1);
    })
    .join(' ');
}

/** Deterministic tags, used when enrichment cannot call the model. */
export function tagsByRules(book: {
  subjectTags: string[];
  editionNumber: number | null;
  courseCodes?: string[];
}): string[] {
  const tags = new Set<string>(book.subjectTags.filter(Boolean));

  if (book.editionNumber !== null) tags.add('edition-sensitive');
  for (const code of book.courseCodes ?? []) {
    const level = courseLevel(code);
    if (level) tags.add(level);
  }
  // Deliberately not padded to the 4-tag floor the model is held to: inventing
  // a tag to hit a minimum is worse than showing two honest ones.
  if (tags.size === 0) tags.add('uncategorised');

  return [...tags].slice(0, 8);
}

/** "CHEM 101" -> intro-level, "PHYS 331" -> upper-division, "NSCI 501" -> grad-level. */
export function courseLevel(courseCode: string): string | null {
  const match = courseCode.match(/(\d{3})/);
  if (!match) return null;
  const number = Number.parseInt(match[1], 10);
  if (number >= 500) return 'grad-level';
  if (number >= 300) return 'upper-division';
  return 'intro-level';
}

/** Deterministic description. Two sentences, no adjectives we did not measure. */
export function describeByRules(book: {
  title: string;
  authors: string[];
  edition: string | null;
  condition: string;
  notes?: string | null;
  courseCodes?: string[];
}): string {
  const byline = book.authors.length ? ` by ${formatAuthorList(book.authors)}` : '';
  const edition = book.edition ? `, ${book.edition}` : '';
  // The course belongs in the first sentence. Two sentences is the rule, and a
  // third one saying "Listed for CHEM 241." would break it.
  const course = book.courseCodes?.length ? `, listed for ${book.courseCodes[0]}` : '';

  const conditionWord = book.condition.replace('_', ' ');
  const notes = book.notes?.trim();
  const second = notes
    ? ` This copy is in ${conditionWord} condition: ${lowerFirst(stripTrailingPeriod(notes))}.`
    : ` This copy is in ${conditionWord} condition.`;

  // "3rd ed." already ends in a period; one more would make it "3rd ed..".
  const first = `${book.title}${edition}${byline}${course}`.replace(/\.?$/, '.');

  return `${first}${second}`.replace(/\s+/g, ' ').trim();
}

function formatAuthorList(authors: string[]): string {
  if (authors.length === 1) return authors[0];
  if (authors.length === 2) return `${authors[0]} and ${authors[1]}`;
  return `${authors[0]} and others`;
}

function stripTrailingPeriod(text: string): string {
  return text.replace(/\.\s*$/, '');
}

function lowerFirst(text: string): string {
  return text.charAt(0).toLowerCase() + text.slice(1);
}

/** Exported for the vocabulary sync test. */
export const _internal = { slugify, titleCase };
