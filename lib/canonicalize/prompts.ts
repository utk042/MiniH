import { CONTROLLED_TAGS, TAG_RULES } from '../tags/vocabulary';

/**
 * Both prompts are extraction tasks with the output shape pinned by
 * responseSchema, so they say what to extract and what not to invent, and stop.
 */

export function canonicalizationPrompt(input: string): string {
  return [
    'You are resolving a second-hand textbook listing typed by a college student into a structured record.',
    'The text is shorthand: "orgo" is organic chemistry, "calc" is calculus, "CLRS" is Cormen et al.,',
    '"baby rudin" is Rudin\'s Principles of Mathematical Analysis, "E&M" is electromagnetism.',
    'Expand abbreviations to the full published title. Correct obvious misspellings of titles and author names.',
    '',
    'Rules:',
    '- Extract only. If the text does not state something, return null rather than a guess.',
    '- title is the published title without edition, volume condition, or price. Keep subtitles.',
    '- Keep the volume in the title when the book is one volume of a set.',
    '- authors are the people credited on the cover, in cover order, as "Given Surname".',
    '- edition_number only if the text states an edition. "3rd", "third ed", "3e" all mean 3.',
    '- condition_guess only if the text describes the physical copy. "spine cracked" is fair or good,',
    '  "never opened" is new, "highlighting" is good, "water damage" is fair or poor. Otherwise null.',
    '- isbn13 only if 13 digits beginning 978 or 979 appear in the text.',
    '- subject_tags: up to five lowercase hyphenated academic subject slugs, e.g. organic-chemistry.',
    '- canonical_key: lowercase hyphenated slug of author surname(s), then title, then edition number.',
    '  One author gives one surname, two give both, three or more give the first only.',
    '  Example: "orgo 3rd ed morrison boyd" gives morrison-boyd-organic-chemistry-3.',
    '- work_key: the same slug without the trailing edition number.',
    '',
    'Listing text:',
    input,
  ].join('\n');
}

export interface EnrichmentInput {
  title: string;
  authors: string[];
  edition: string | null;
  subjectTags: string[];
  condition: string;
  notes: string | null;
  courseCodes: string[];
}

export function enrichmentPrompt(book: EnrichmentInput): string {
  return [
    'Write tags and a description for one second-hand textbook listed by a student on a campus exchange.',
    '',
    `TAGS: between ${TAG_RULES.min} and ${TAG_RULES.max}, lowercase, hyphenated.`,
    `Take at least ${TAG_RULES.minControlled} from this list, and use the list wherever it fits:`,
    CONTROLLED_TAGS.join(', '),
    `You may add up to ${TAG_RULES.maxFree} tags that are not on the list only for things the list cannot express.`,
    'Tags describe the book and the course it serves, never the condition and never the price.',
    '',
    'DESCRIPTION: at most two sentences, plain and factual, written from the data below.',
    'State what the book is and what condition this copy is in. Nothing else.',
    'No sales language, no second person, no adjectives of enthusiasm, no exclamation marks, no emoji.',
    'Do not write "perfect for", "great condition", "must-have", "elevate", "dive into", or "look no further".',
    'A campus noticeboard card, not a product page.',
    '',
    'Book:',
    `  title: ${book.title}`,
    `  authors: ${book.authors.join(', ') || 'unknown'}`,
    `  edition: ${book.edition ?? 'not stated'}`,
    `  subjects: ${book.subjectTags.join(', ') || 'not stated'}`,
    `  courses: ${book.courseCodes.join(', ') || 'not stated'}`,
    `  condition: ${book.condition}`,
    `  seller notes: ${book.notes ?? 'none'}`,
  ].join('\n');
}
