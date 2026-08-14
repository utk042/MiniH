import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';
import {
  assertUsableInput,
  hashInput,
  hashStructured,
  InputTooThinError,
  normalizeInput,
} from '../lib/canonicalize/normalize';

describe('normalizeInput', () => {
  it('collapses the differences that should not cost an API call', () => {
    const canonical = normalizeInput('orgo 3rd ed morrison boyd, spine cracked');
    const variants = [
      '  ORGO 3rd ed morrison boyd, spine cracked  ',
      'orgo   3rd   ed   morrison boyd,   spine cracked',
      'Orgo 3rd Ed Morrison Boyd, Spine Cracked',
      'orgo 3rd ed morrison boyd,\tspine cracked',
    ];

    for (const variant of variants) {
      assert.equal(normalizeInput(variant), canonical, variant);
    }
  });

  it('folds the quotes and dashes phone keyboards produce', () => {
    assert.equal(normalizeInput('gray’s anatomy — 4th ed'), normalizeInput("gray's anatomy - 4th ed"));
    assert.equal(normalizeInput('“baby rudin”'), normalizeInput('"baby rudin"'));
  });

  it('keeps differences that change which book is meant', () => {
    assert.notEqual(normalizeInput('stewart calculus 8th'), normalizeInput('stewart calculus 9th'));
    assert.notEqual(normalizeInput('university physics vol 1'), normalizeInput('university physics vol 2'));
  });
});

describe('hashInput', () => {
  it('is a 64-character hex digest, which the cache table checks for', () => {
    assert.match(hashInput('campbell biology 12e'), /^[a-f0-9]{64}$/);
  });

  it('is taken over the normalised form', () => {
    assert.equal(hashInput('  CAMPBELL   biology 12e '), hashInput('campbell biology 12e'));
  });

  it('differs for different books', () => {
    assert.notEqual(hashInput('campbell biology 12e'), hashInput('campbell biology 11e'));
  });
});

describe('hashStructured', () => {
  it('ignores key order', () => {
    assert.equal(
      hashStructured({ title: 'A', authors: ['B'], edition: null }),
      hashStructured({ edition: null, authors: ['B'], title: 'A' }),
    );
  });

  it('does not ignore array order, which is author order', () => {
    assert.notEqual(hashStructured({ authors: ['A', 'B'] }), hashStructured({ authors: ['B', 'A'] }));
  });

  it('distinguishes null from absent', () => {
    assert.notEqual(hashStructured({ a: null }), hashStructured({}));
  });
});

describe('assertUsableInput', () => {
  it('accepts a real listing', () => {
    assert.equal(
      assertUsableInput('  orgo 3rd ed morrison boyd  '),
      'orgo 3rd ed morrison boyd',
    );
  });

  for (const input of ['', '   ', 'ok', '?!', '12']) {
    it(`refuses ${JSON.stringify(input)}`, () => {
      assert.throws(() => assertUsableInput(input), InputTooThinError);
    });
  }

  it('refuses a pasted chapter and says how long it was', () => {
    assert.throws(() => assertUsableInput('a'.repeat(1500)), /1500 characters/);
  });
});
