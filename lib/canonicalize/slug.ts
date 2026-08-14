/**
 * Key derivation. This is the part that must be deterministic, so it is code,
 * not a model output.
 *
 * The model is asked for a canonical_key, but its answer is only ever used as a
 * cross-check: the key that gets written is always the one computed here from
 * {authors, title, edition}. A model that is right 99% of the time still
 * fragments the graph 1% of the time, and a fragmented graph finds no cycles.
 *
 * Note on parity with SQL: public.slugify() in migration 000100 is the cruder
 * ASCII-only version, and it is used only for account handles. Canonical keys
 * are minted here and nowhere else.
 */

/** Name suffixes that are not surnames. */
const NAME_SUFFIXES = new Set(['jr', 'jr.', 'sr', 'sr.', 'ii', 'iii', 'iv', 'phd', 'ph.d.', 'md', 'm.d.', 'esq']);

/** Surname particles that belong with the surname: "van der Waals". */
const NAME_PARTICLES = new Set([
  'van', 'von', 'de', 'del', 'della', 'der', 'den', 'di', 'da', 'dos', 'du',
  'la', 'le', 'les', 'ten', 'ter', 'st', 'st.', 'san', 'mac', 'mc', 'al',
]);

/** Leading articles are dropped from titles so "The X" and "X" agree. */
const LEADING_ARTICLES = /^(the|a|an)\s+/i;

const MAX_WORK_KEY_LENGTH = 90;

/**
 * Letters that do not decompose under NFD, so they have to be spelled out.
 * public.slugify() in migration 000700 carries the same list, and
 * scripts/db/parity.ts asserts the two implementations still agree.
 */
const LIGATURES: ReadonlyArray<[RegExp, string]> = [
  [/\u00e6/g, 'ae'],
  [/\u0153/g, 'oe'],
  [/\u00df/g, 'ss'],
  [/\u00f8/g, 'o'],
  [/\u0111/g, 'd'],
  [/\u00f0/g, 'd'],
  [/\u0142/g, 'l'],
  [/\u0127/g, 'h'],
  [/\u0131/g, 'i'],
  [/\u00fe/g, 'th'],
];

export function slugify(text: string): string {
  let working = text.toLowerCase();
  for (const [pattern, replacement] of LIGATURES) {
    working = working.replace(pattern, replacement);
  }

  return working
    .normalize('NFD')
    // Strip combining marks so "Díaz" becomes "diaz" rather than "d-az".
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

/**
 * "Robert T. Morrison" -> "morrison". "Morrison, Robert T." -> "morrison".
 * "Ludwig van Beethoven" -> "van-beethoven". Returns '' if nothing usable.
 */
export function surnameOf(author: string): string {
  const cleaned = author.replace(/\(.*?\)/g, ' ').trim();
  if (!cleaned) return '';

  // "Surname, Given" form.
  if (cleaned.includes(',')) {
    const [surname] = cleaned.split(',');
    const slug = slugify(surname);
    if (slug) return slug;
  }

  const tokens = cleaned
    .split(/\s+/)
    .map((t) => t.trim())
    .filter(Boolean)
    .filter((t) => !NAME_SUFFIXES.has(t.toLowerCase().replace(/[,]/g, '')));

  if (tokens.length === 0) return '';

  let start = tokens.length - 1;
  while (start > 0 && NAME_PARTICLES.has(tokens[start - 1].toLowerCase().replace(/\./g, ''))) {
    start -= 1;
  }

  return slugify(tokens.slice(start).join('-'));
}

/**
 * One author gives one surname, two give both, three or more give the first
 * only. That last rule is what keeps "Brown, LeMay, Bursten" from turning into
 * a key nobody would recognise, and it matches how these books get referred to
 * out loud.
 */
export function authorSegment(authors: readonly string[]): string {
  const surnames = authors.map(surnameOf).filter(Boolean);
  if (surnames.length === 0) return '';
  if (surnames.length <= 2) return surnames.join('-');
  return surnames[0];
}

export function titleSegment(title: string): string {
  return slugify(title.replace(LEADING_ARTICLES, ''));
}

export interface KeyParts {
  title: string;
  authors?: readonly string[];
  editionNumber?: number | null;
}

export interface DerivedKeys {
  workKey: string;
  canonicalKey: string;
}

/**
 * work_key identifies the work across editions; canonical_key identifies one
 * edition of it. canonical_key always extends work_key, which the books table
 * enforces with a check constraint.
 */
export function deriveKeys({ title, authors = [], editionNumber = null }: KeyParts): DerivedKeys {
  const segments = [authorSegment(authors), titleSegment(title)].filter(Boolean);
  let workKey = segments.join('-');

  if (!workKey) workKey = 'untitled';
  workKey = truncateAtBoundary(workKey, MAX_WORK_KEY_LENGTH);

  const canonicalKey =
    editionNumber && Number.isInteger(editionNumber) && editionNumber > 0
      ? `${workKey}-${editionNumber}`
      : workKey;

  return { workKey, canonicalKey };
}

/** Cut on a hyphen so a truncated key never ends mid-word or with '-'. */
function truncateAtBoundary(slug: string, max: number): string {
  if (slug.length <= max) return slug;
  const cut = slug.slice(0, max);
  const lastHyphen = cut.lastIndexOf('-');
  return (lastHyphen > 0 ? cut.slice(0, lastHyphen) : cut).replace(/-+$/, '');
}

export const SLUG_PATTERN = /^[a-z0-9]+(-[a-z0-9]+)*$/;

export function isSlug(value: string): boolean {
  return SLUG_PATTERN.test(value);
}

/** Matches the generated title_key column on public.books. */
export function titleKey(title: string): string {
  return titleSegment(title);
}

// --- edition parsing -------------------------------------------------------

const ORDINAL_WORDS: Record<string, number> = {
  first: 1, second: 2, third: 3, fourth: 4, fifth: 5, sixth: 6, seventh: 7,
  eighth: 8, ninth: 9, tenth: 10, eleventh: 11, twelfth: 12, thirteenth: 13,
  fourteenth: 14, fifteenth: 15, sixteenth: 16, seventeenth: 17,
  eighteenth: 18, nineteenth: 19, twentieth: 20,
};

/**
 * Pulls an edition number out of free text: "3rd ed", "third edition", "12e",
 * "ed. 4", "(2nd)". Returns null rather than guessing.
 */
export function parseEditionNumber(text: string): number | null {
  const haystack = text.toLowerCase();

  for (const [word, value] of Object.entries(ORDINAL_WORDS)) {
    if (new RegExp(`\\b${word}\\b\\s*(ed\\b|edn\\b|edition\\b)`).test(haystack)) return value;
  }

  const patterns = [
    /\b(\d{1,2})\s*(?:st|nd|rd|th)\s*(?:ed\b|edn\b|edition\b)/,
    /\b(?:ed\.?|edn\.?|edition)\s*(\d{1,2})\b/,
    /\b(\d{1,2})\s*(?:st|nd|rd|th)\b/,
    /\b(\d{1,2})e\b/,
    /\(\s*(\d{1,2})\s*(?:st|nd|rd|th)?\s*\)/,
  ];

  for (const pattern of patterns) {
    const match = haystack.match(pattern);
    if (match) {
      const value = Number.parseInt(match[1], 10);
      if (value >= 1 && value <= 60) return value;
    }
  }

  return null;
}

const ORDINAL_SUFFIX = (n: number): string => {
  const mod100 = n % 100;
  if (mod100 >= 11 && mod100 <= 13) return 'th';
  return ['th', 'st', 'nd', 'rd'][n % 10] ?? 'th';
};

/** 3 -> "3rd ed.". Matches the edition_label the seed writes. */
export function editionLabel(editionNumber: number | null | undefined): string | null {
  if (!editionNumber || !Number.isInteger(editionNumber)) return null;
  return `${editionNumber}${ORDINAL_SUFFIX(editionNumber)} ed.`;
}

/** Strips ISBN hyphens and validates the check digit. */
export function parseIsbn13(text: string): string | null {
  // Lookarounds rather than \b: after hyphen stripping the digits usually butt
  // straight up against a word, as in "isbn9780134093413", where \b never fires.
  const match = text.replace(/[\s-]/g, '').match(/(?<!\d)(97[89]\d{10})(?!\d)/);
  if (!match) return null;
  const digits = match[1];
  let sum = 0;
  for (let i = 0; i < 12; i += 1) {
    sum += Number(digits[i]) * (i % 2 === 0 ? 1 : 3);
  }
  const check = (10 - (sum % 10)) % 10;
  return check === Number(digits[12]) ? digits : null;
}
