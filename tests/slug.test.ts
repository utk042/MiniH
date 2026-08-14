import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';
import {
  authorSegment,
  deriveKeys,
  editionLabel,
  isSlug,
  parseEditionNumber,
  parseIsbn13,
  slugify,
  surnameOf,
  titleKey,
} from '../lib/canonicalize/slug';

describe('slugify', () => {
  it('produces keys the books table will accept', () => {
    for (const input of ['Organic Chemistry', "Gray's Anatomy for Students", 'Physics!! (vol 1)']) {
      assert.ok(isSlug(slugify(input)), `${input} -> ${slugify(input)}`);
    }
  });

  it('folds accents rather than dropping them', () => {
    assert.equal(slugify('Junot Díaz'), 'junot-diaz');
    assert.equal(slugify('Émile Durkheim'), 'emile-durkheim');
  });

  it('collapses punctuation runs', () => {
    assert.equal(slugify('Calculus: Early Transcendentals'), 'calculus-early-transcendentals');
    assert.equal(slugify('  --Republic--  '), 'republic');
  });
});

describe('surnameOf', () => {
  const cases: Array<[string, string]> = [
    ['Robert T. Morrison', 'morrison'],
    ['J. J. Sakurai', 'sakurai'],
    ['Morrison, Robert T.', 'morrison'],
    ['William Strunk Jr.', 'strunk'],
    ['Junot Díaz', 'diaz'],
    ['Ludwig van Beethoven', 'van-beethoven'],
    ['N. Gregory Mankiw', 'mankiw'],
    ['Plato', 'plato'],
    ['', ''],
  ];

  for (const [input, expected] of cases) {
    it(`${input || '(empty)'} -> ${expected || '(empty)'}`, () => {
      assert.equal(surnameOf(input), expected);
    });
  }
});

describe('authorSegment', () => {
  it('uses one surname for one author', () => {
    assert.equal(authorSegment(['Sheldon Axler']), 'axler');
  });

  it('uses both surnames for two authors', () => {
    assert.equal(authorSegment(['Robert T. Morrison', 'Robert N. Boyd']), 'morrison-boyd');
  });

  it('uses the first surname only for three or more', () => {
    assert.equal(
      authorSegment(['Thomas H. Cormen', 'Charles E. Leiserson', 'Ronald L. Rivest', 'Clifford Stein']),
      'cormen',
    );
  });

  it('is empty when nobody is credited', () => {
    assert.equal(authorSegment([]), '');
  });
});

describe('deriveKeys', () => {
  it('produces the key from the brief', () => {
    const { canonicalKey, workKey } = deriveKeys({
      title: 'Organic Chemistry',
      authors: ['Robert T. Morrison', 'Robert N. Boyd'],
      editionNumber: 3,
    });
    assert.equal(canonicalKey, 'morrison-boyd-organic-chemistry-3');
    assert.equal(workKey, 'morrison-boyd-organic-chemistry');
  });

  it('always extends work_key with the edition, as the check constraint requires', () => {
    const { canonicalKey, workKey } = deriveKeys({
      title: 'Calculus: Early Transcendentals',
      authors: ['James Stewart'],
      editionNumber: 8,
    });
    assert.ok(canonicalKey.startsWith(`${workKey}-`));
  });

  it('omits the edition when none is known', () => {
    const { canonicalKey, workKey } = deriveKeys({ title: 'Republic', authors: ['Plato'] });
    assert.equal(canonicalKey, workKey);
    assert.equal(canonicalKey, 'plato-republic');
  });

  it('drops a leading article so "The X" and "X" agree', () => {
    assert.equal(
      deriveKeys({ title: 'The Elements of Style', authors: ['William Strunk Jr.'] }).canonicalKey,
      'strunk-elements-of-style',
    );
  });

  it('is stable across capitalisation and spacing of the same fields', () => {
    const a = deriveKeys({ title: 'Organic Chemistry', authors: ['Robert T. Morrison', 'Robert N. Boyd'], editionNumber: 3 });
    const b = deriveKeys({ title: '  organic   chemistry ', authors: ['MORRISON, ROBERT T.', 'boyd, robert n.'], editionNumber: 3 });
    assert.equal(a.canonicalKey, b.canonicalKey);
  });

  it('truncates a runaway title on a hyphen boundary', () => {
    const { canonicalKey, workKey } = deriveKeys({
      title: 'A '.repeat(80) + 'Very Long Title Indeed',
      authors: ['Someone Longname'],
      editionNumber: 2,
    });
    assert.ok(isSlug(canonicalKey), canonicalKey);
    assert.ok(workKey.length <= 90);
    assert.ok(canonicalKey.startsWith(`${workKey}-`));
  });

  it('never returns an empty key', () => {
    assert.equal(deriveKeys({ title: '', authors: [] }).canonicalKey, 'untitled');
  });
});

describe('parseEditionNumber', () => {
  const cases: Array<[string, number | null]> = [
    ['orgo 3rd ed morrison boyd', 3],
    ['campbell bio 12e', 12],
    ['norton anthology amer lit vol B ninth edition', 9],
    ['openstax univ physics vol 1 (2nd)', 2],
    ['ed. 4 hardcover', 4],
    ['stewart calculus 8th', 8],
    ['no edition mentioned here', null],
    ['isbn 9780134093413', null],
  ];

  for (const [input, expected] of cases) {
    it(`${input} -> ${expected}`, () => {
      assert.equal(parseEditionNumber(input), expected);
    });
  }
});

describe('editionLabel', () => {
  it('matches the labels the seed writes', () => {
    assert.equal(editionLabel(1), '1st ed.');
    assert.equal(editionLabel(3), '3rd ed.');
    assert.equal(editionLabel(11), '11th ed.');
    assert.equal(editionLabel(12), '12th ed.');
    assert.equal(editionLabel(13), '13th ed.');
    assert.equal(editionLabel(22), '22nd ed.');
    assert.equal(editionLabel(null), null);
  });
});

describe('parseIsbn13', () => {
  it('accepts a valid ISBN with or without hyphens', () => {
    assert.equal(parseIsbn13('isbn 978-0-13-409341-3'), '9780134093413');
    assert.equal(parseIsbn13('9780134093413'), '9780134093413');
  });

  it('rejects a failed check digit rather than storing a wrong number', () => {
    assert.equal(parseIsbn13('9780134093414'), null);
  });

  it('ignores unrelated digit runs', () => {
    assert.equal(parseIsbn13('call me on 5551234567890'), null);
  });
});

describe('titleKey', () => {
  it('agrees with the generated column in migration 000700', () => {
    assert.equal(titleKey('The Riverside Shakespeare'), 'riverside-shakespeare');
    assert.equal(titleKey('Calculus: Early Transcendentals'), 'calculus-early-transcendentals');
  });
});
