import type { GenerateJson } from '../../lib/ai/gemini';
import type { BookCatalogue, CatalogueMatch } from '../../lib/canonicalize/ports';

/**
 * Ten listings written the way students actually type them, with the response
 * a competent model returns for each.
 *
 * What this exercises is OUR half of the pipeline: normalisation, validation,
 * key derivation, catalogue resolution, caching and the fallback path. It does
 * not measure Gemini's accuracy — that needs a key and a live call, which is
 * what `npm run canon` is for.
 *
 * Five of these derive straight to the key the seed already uses. The other
 * five do not, because a title-and-authors slug cannot reproduce a name like
 * `campbell-biology-12`, and that is exactly the case catalogue resolution
 * exists to catch.
 */

export interface MessyCase {
  input: string;
  /** What a good model returns. */
  modelOutput: Record<string, unknown>;
  /** The key we expect once derivation and resolution have run. */
  expectedKey: string;
  /** True when the key comes from the catalogue rather than from derivation. */
  expectResolved: boolean;
  note: string;
}

export const MESSY_CASES: MessyCase[] = [
  {
    input: 'orgo 3rd ed morrison boyd, spine cracked',
    modelOutput: {
      title: 'Organic Chemistry',
      authors: ['Robert T. Morrison', 'Robert N. Boyd'],
      edition: '3rd ed.',
      edition_number: 3,
      subject_tags: ['chemistry', 'organic-chemistry'],
      condition_guess: 'good',
      isbn13: null,
      canonical_key: 'morrison-boyd-organic-chemistry-3',
      work_key: 'morrison-boyd-organic-chemistry',
    },
    expectedKey: 'morrison-boyd-organic-chemistry-3',
    expectResolved: true,
    note: 'shorthand subject, two authors, condition tacked on the end',
  },
  {
    input: 'campbell bio 12e — hilighted a bit, still fine',
    modelOutput: {
      title: 'Campbell Biology',
      authors: ['Lisa A. Urry', 'Michael L. Cain', 'Steven A. Wasserman'],
      edition: '12th ed.',
      edition_number: 12,
      subject_tags: ['biology'],
      condition_guess: 'good',
      isbn13: null,
      canonical_key: 'urry-campbell-biology-12',
      work_key: 'urry-campbell-biology',
    },
    // Derivation gives urry-campbell-biology-12; the campus already calls this
    // book campbell-biology-12, and resolution keeps it there.
    expectedKey: 'campbell-biology-12',
    expectResolved: true,
    note: 'misspelling, em dash, three authors, catalogue name differs from derivation',
  },
  {
    input: 'stewart calc early transcendentals 8th, loose cover taped',
    modelOutput: {
      title: 'Calculus: Early Transcendentals',
      authors: ['James Stewart'],
      edition: '8th ed.',
      edition_number: 8,
      subject_tags: ['mathematics', 'calculus'],
      condition_guess: 'fair',
      isbn13: null,
      canonical_key: 'stewart-calculus-early-transcendentals-8',
      work_key: 'stewart-calculus-early-transcendentals',
    },
    expectedKey: 'stewart-calculus-early-transcendentals-8',
    expectResolved: true,
    note: 'abbreviated subject, subtitle must survive into the key',
  },
  {
    input: 'axler LADR 4th ed brand new never opened',
    modelOutput: {
      title: 'Linear Algebra Done Right',
      authors: ['Sheldon Axler'],
      edition: '4th ed.',
      edition_number: 4,
      subject_tags: ['mathematics', 'linear-algebra'],
      condition_guess: 'new',
      isbn13: null,
      canonical_key: 'axler-linear-algebra-done-right-4',
      work_key: 'axler-linear-algebra-done-right',
    },
    expectedKey: 'axler-linear-algebra-done-right-4',
    expectResolved: true,
    note: 'initialism only a student would use',
  },
  {
    input: 'griffiths E&M 4e (intro to electrodynamics) some pencil',
    modelOutput: {
      title: 'Introduction to Electrodynamics',
      authors: ['David J. Griffiths'],
      edition: '4th ed.',
      edition_number: 4,
      subject_tags: ['physics', 'electromagnetism'],
      condition_guess: 'good',
      isbn13: null,
      canonical_key: 'griffiths-introduction-to-electrodynamics-4',
      work_key: 'griffiths-introduction-to-electrodynamics',
    },
    expectedKey: 'griffiths-introduction-to-electrodynamics-4',
    expectResolved: true,
    note: 'ampersand, parenthetical, an author with two very different books',
  },
  {
    input: 'norton anthology amer lit vol B ninth edition',
    modelOutput: {
      title: 'The Norton Anthology of American Literature, Volume B',
      authors: ['Robert S. Levine'],
      edition: '9th ed.',
      edition_number: 9,
      subject_tags: ['literature', 'american-literature', 'anthology'],
      condition_guess: null,
      isbn13: null,
      canonical_key: 'levine-norton-anthology-of-american-literature-volume-b-9',
      work_key: 'levine-norton-anthology-of-american-literature-volume-b',
    },
    expectedKey: 'norton-anthology-american-literature-b-9',
    expectResolved: true,
    note: 'ordinal word, truncated words, volume must not be lost',
  },
  {
    input: 'cormen clrs 4th, hardcover, sticker on spine',
    modelOutput: {
      title: 'Introduction to Algorithms',
      authors: ['Thomas H. Cormen', 'Charles E. Leiserson', 'Ronald L. Rivest', 'Clifford Stein'],
      edition: '4th ed.',
      edition_number: 4,
      subject_tags: ['computer-science', 'algorithms'],
      condition_guess: 'good',
      isbn13: null,
      canonical_key: 'cormen-introduction-to-algorithms-4',
      work_key: 'cormen-introduction-to-algorithms',
    },
    expectedKey: 'cormen-introduction-to-algorithms-4',
    expectResolved: true,
    note: 'four authors, book known by an acronym of their initials',
  },
  {
    input: 'mankiw princ of econ 9th ed water damage bottom edge',
    modelOutput: {
      title: 'Principles of Economics',
      authors: ['N. Gregory Mankiw'],
      edition: '9th ed.',
      edition_number: 9,
      subject_tags: ['economics'],
      condition_guess: 'fair',
      isbn13: null,
      canonical_key: 'mankiw-principles-of-economics-9',
      work_key: 'mankiw-principles-of-economics',
    },
    expectedKey: 'mankiw-principles-of-economics-9',
    expectResolved: true,
    note: 'truncated words, damage described in passing',
  },
  {
    input: 'openstax univ physics vol 1 (2nd) pdf printout bound',
    modelOutput: {
      title: 'University Physics, Volume 1',
      authors: ['Samuel J. Ling', 'Jeff Sanny', 'William Moebs'],
      edition: '2nd ed.',
      edition_number: 2,
      subject_tags: ['physics', 'mechanics', 'open-access'],
      condition_guess: null,
      isbn13: null,
      canonical_key: 'ling-university-physics-volume-1-2',
      work_key: 'ling-university-physics-volume-1',
    },
    // Everyone calls this the OpenStax book, not the Ling book.
    expectedKey: 'openstax-university-physics-volume-1-2',
    expectResolved: true,
    note: 'publisher used as the author, edition in parentheses',
  },
  {
    input: 'rudin baby rudin 3rd ed hardcover, initials on flyleaf',
    modelOutput: {
      title: 'Principles of Mathematical Analysis',
      authors: ['Walter Rudin'],
      edition: '3rd ed.',
      edition_number: 3,
      subject_tags: ['mathematics', 'real-analysis'],
      condition_guess: 'good',
      isbn13: null,
      canonical_key: 'rudin-principles-of-mathematical-analysis-3',
      work_key: 'rudin-principles-of-mathematical-analysis',
    },
    expectedKey: 'rudin-principles-of-mathematical-analysis-3',
    expectResolved: true,
    note: 'nickname the title never contains',
  },
];

/**
 * A stand-in for the campus catalogue, holding the handful of seeded books the
 * fixtures need. Same matching rules as public.resolve_book: ISBN first, then
 * title plus edition plus a shared surname.
 */
export function fakeCatalogue(rows: SeededBook[] = SEEDED_BOOKS): BookCatalogue {
  return {
    async find(query) {
      if (query.isbn13) {
        const byIsbn = rows.find((r) => r.isbn13 === query.isbn13);
        if (byIsbn) return byIsbn;
      }
      return (
        rows.find(
          (r) =>
            r.titleKey === query.titleKey &&
            r.editionNumber === query.editionNumber &&
            (query.surnames.length === 0 ||
              r.surnames.length === 0 ||
              r.surnames.some((s) => query.surnames.includes(s))),
        ) ?? null
      );
    },
  };
}

export interface SeededBook extends CatalogueMatch {
  titleKey: string;
  surnames: string[];
  isbn13: string | null;
}

export const SEEDED_BOOKS: SeededBook[] = [
  book('morrison-boyd-organic-chemistry-3', 'Organic Chemistry', ['Robert T. Morrison', 'Robert N. Boyd'], 3, ['morrison', 'boyd'], ['chemistry', 'organic-chemistry'], ['CHEM 241']),
  book('campbell-biology-12', 'Campbell Biology', ['Lisa A. Urry', 'Michael L. Cain', 'Steven A. Wasserman'], 12, ['urry', 'cain', 'wasserman'], ['biology', 'intro-level'], ['BIOL 111']),
  book('stewart-calculus-early-transcendentals-8', 'Calculus: Early Transcendentals', ['James Stewart'], 8, ['stewart'], ['mathematics', 'calculus'], ['MATH 121']),
  book('axler-linear-algebra-done-right-4', 'Linear Algebra Done Right', ['Sheldon Axler'], 4, ['axler'], ['mathematics', 'linear-algebra'], ['MATH 214']),
  book('griffiths-introduction-to-electrodynamics-4', 'Introduction to Electrodynamics', ['David J. Griffiths'], 4, ['griffiths'], ['physics', 'electromagnetism'], ['PHYS 331']),
  book('norton-anthology-american-literature-b-9', 'The Norton Anthology of American Literature, Volume B', ['Robert S. Levine'], 9, ['levine'], ['literature', 'anthology'], ['ENGL 210']),
  book('cormen-introduction-to-algorithms-4', 'Introduction to Algorithms', ['Thomas H. Cormen', 'Charles E. Leiserson'], 4, ['cormen', 'leiserson'], ['computer-science', 'algorithms'], ['CS 310']),
  book('mankiw-principles-of-economics-9', 'Principles of Economics', ['N. Gregory Mankiw'], 9, ['mankiw'], ['economics'], ['ECON 101']),
  book('openstax-university-physics-volume-1-2', 'University Physics, Volume 1', ['Samuel J. Ling', 'Jeff Sanny', 'William Moebs'], 2, ['ling', 'sanny', 'moebs'], ['physics', 'open-access'], ['PHYS 121']),
  book('rudin-principles-of-mathematical-analysis-3', 'Principles of Mathematical Analysis', ['Walter Rudin'], 3, ['rudin'], ['mathematics', 'real-analysis'], ['MATH 351']),
];

function book(
  canonicalKey: string,
  title: string,
  authors: string[],
  editionNumber: number,
  surnames: string[],
  subjectTags: string[],
  courseCodes: string[],
): SeededBook {
  return {
    canonicalKey,
    workKey: canonicalKey.replace(/-\d+$/, ''),
    title,
    authors,
    editionNumber,
    editionLabel: `${editionNumber}th ed.`,
    subjectTags,
    courseCodes,
    titleKey: title
      .replace(/^(the|a|an)\s+/i, '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, ''),
    surnames,
    isbn13: null,
  };
}

/** Counts calls, so a test can assert the cache actually saved one. */
export interface CountingGenerator {
  generate: GenerateJson;
  calls: string[];
}

export function fakeGemini(
  respond: (prompt: string) => string | Promise<string>,
): CountingGenerator {
  const calls: string[] = [];
  return {
    calls,
    generate: async ({ prompt }) => {
      calls.push(prompt);
      return { text: await respond(prompt), model: 'gemini-2.5-flash-lite' };
    },
  };
}

/** Picks the fixture whose input appears in the prompt. */
export function respondFromFixtures(prompt: string): string {
  const match = MESSY_CASES.find((c) => prompt.includes(c.input));
  if (!match) throw new Error(`No fixture for prompt: ${prompt.slice(-120)}`);
  return JSON.stringify(match.modelOutput);
}
