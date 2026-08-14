import { strict as assert } from 'node:assert';
import { beforeEach, describe, it } from 'node:test';
import { canonicalize, _resetInFlight } from '../lib/canonicalize/canonicalize';
import { applyHumanOverride } from '../lib/canonicalize/override';
import { canonicalizeByRules, describeByRules } from '../lib/canonicalize/fallback';
import { hashInput, InputTooThinError, normalizeInput } from '../lib/canonicalize/normalize';
import { emptyCatalogue, InMemoryCache } from '../lib/canonicalize/ports';
import { isSlug } from '../lib/canonicalize/slug';
import {
  fakeCatalogue,
  fakeGemini,
  MESSY_CASES,
  respondFromFixtures,
} from './fixtures/messy-inputs';

beforeEach(() => {
  _resetInFlight();
});

describe('canonicalize: ten listings as students actually type them', () => {
  for (const messy of MESSY_CASES) {
    it(`${messy.input}  (${messy.note})`, async () => {
      const gemini = fakeGemini(respondFromFixtures);
      const result = await canonicalize(messy.input, {
        generate: gemini.generate,
        catalogue: fakeCatalogue(),
        cache: new InMemoryCache(),
      });

      assert.equal(result.record.canonicalKey, messy.expectedKey);
      assert.equal(result.matchedExistingBook, messy.expectResolved);
      assert.equal(result.source, 'gemini');
      assert.ok(isSlug(result.record.canonicalKey), result.record.canonicalKey);
      assert.ok(
        result.record.canonicalKey === result.record.workKey ||
          result.record.canonicalKey.startsWith(`${result.record.workKey}-`),
        'canonical_key must extend work_key, as the books check constraint requires',
      );
      assert.equal(gemini.calls.length, 1);
    });
  }

  it('lands every fixture on a key the books table would accept', async () => {
    for (const messy of MESSY_CASES) {
      const result = await canonicalize(messy.input, {
        generate: fakeGemini(respondFromFixtures).generate,
        catalogue: fakeCatalogue(),
      });
      assert.ok(isSlug(result.record.canonicalKey));
      assert.ok(result.record.title.length > 0);
    }
  });
});

describe('canonicalize: two descriptions, one node', () => {
  it('resolves differently-typed listings for the same book to the same key', async () => {
    const phrasings = [
      { input: 'orgo 3rd ed morrison boyd, spine cracked', output: MESSY_CASES[0].modelOutput },
      {
        input: 'Organic Chemistry, Morrison & Boyd, 3rd edition — no writing inside',
        output: MESSY_CASES[0].modelOutput,
      },
      {
        input: 'morrison and boyd organic chem, third ed, ex-library',
        output: { ...MESSY_CASES[0].modelOutput, condition_guess: 'fair' },
      },
    ];

    const keys = new Set<string>();
    for (const phrasing of phrasings) {
      const result = await canonicalize(phrasing.input, {
        generate: fakeGemini(() => JSON.stringify(phrasing.output)).generate,
        catalogue: fakeCatalogue(),
      });
      keys.add(result.record.canonicalKey);
    }

    assert.equal(keys.size, 1, `expected one node, got ${[...keys].join(', ')}`);
    assert.equal([...keys][0], 'morrison-boyd-organic-chemistry-3');
  });

  it('keeps two different books that share a title apart', async () => {
    const morrison = await canonicalize('orgo 3rd ed morrison boyd, spine cracked', {
      generate: fakeGemini(respondFromFixtures).generate,
      catalogue: fakeCatalogue(),
    });

    const mcmurry = await canonicalize('mcmurry organic chemistry 9th ed', {
      generate: fakeGemini(() =>
        JSON.stringify({
          title: 'Organic Chemistry',
          authors: ['John E. McMurry'],
          edition: '9th ed.',
          edition_number: 9,
          subject_tags: ['chemistry', 'organic-chemistry'],
          condition_guess: null,
          isbn13: null,
          canonical_key: 'mcmurry-organic-chemistry-9',
          work_key: 'mcmurry-organic-chemistry',
        }),
      ).generate,
      catalogue: fakeCatalogue(),
    });

    assert.notEqual(morrison.record.canonicalKey, mcmurry.record.canonicalKey);
    assert.equal(mcmurry.record.canonicalKey, 'mcmurry-organic-chemistry-9');
    assert.equal(mcmurry.matchedExistingBook, false);
  });

  it('keeps two editions of one work on separate nodes but one work_key', async () => {
    const eighth = await canonicalize('stewart calc early transcendentals 8th, loose cover taped', {
      generate: fakeGemini(respondFromFixtures).generate,
      catalogue: fakeCatalogue(),
    });

    const ninth = await canonicalize('stewart calculus early transcendentals 9th edition', {
      generate: fakeGemini(() =>
        JSON.stringify({ ...MESSY_CASES[2].modelOutput, edition: '9th ed.', edition_number: 9 }),
      ).generate,
      catalogue: fakeCatalogue(),
    });

    assert.notEqual(eighth.record.canonicalKey, ninth.record.canonicalKey);
    assert.equal(eighth.record.workKey, ninth.record.workKey);
  });
});

describe('canonicalize: the cache', () => {
  it('costs zero API calls the second time the same string is typed', async () => {
    const cache = new InMemoryCache();
    const gemini = fakeGemini(respondFromFixtures);
    const input = MESSY_CASES[0].input;

    const first = await canonicalize(input, { generate: gemini.generate, cache, catalogue: fakeCatalogue() });
    const second = await canonicalize(input, { generate: gemini.generate, cache, catalogue: fakeCatalogue() });

    assert.equal(gemini.calls.length, 1);
    assert.equal(first.source, 'gemini');
    assert.equal(second.source, 'cache');
    assert.equal(second.record.canonicalKey, first.record.canonicalKey);
    assert.deepEqual(cache.hits, [hashInput(input)]);
  });

  it('hits on spacing, case and curly-quote differences', async () => {
    const cache = new InMemoryCache();
    const gemini = fakeGemini(respondFromFixtures);
    const input = MESSY_CASES[0].input;

    await canonicalize(input, { generate: gemini.generate, cache, catalogue: fakeCatalogue() });
    const variant = await canonicalize(`  ORGO 3rd ed   Morrison Boyd,  Spine Cracked `, {
      generate: gemini.generate,
      cache,
      catalogue: fakeCatalogue(),
    });

    assert.equal(gemini.calls.length, 1);
    assert.equal(variant.source, 'cache');
  });

  it('collapses a simultaneous duplicate into one call', async () => {
    const cache = new InMemoryCache();
    const gemini = fakeGemini(respondFromFixtures);
    const input = MESSY_CASES[3].input;

    const [a, b] = await Promise.all([
      canonicalize(input, { generate: gemini.generate, cache, catalogue: fakeCatalogue() }),
      canonicalize(input, { generate: gemini.generate, cache, catalogue: fakeCatalogue() }),
    ]);

    assert.equal(gemini.calls.length, 1);
    assert.equal(a.record.canonicalKey, b.record.canonicalKey);
  });

  it('survives a cache that is down', async () => {
    const brokenCache = {
      async get() {
        throw new Error('supabase unreachable');
      },
      async put() {
        throw new Error('supabase unreachable');
      },
      async bumpHit() {
        throw new Error('supabase unreachable');
      },
    };

    const result = await canonicalize(MESSY_CASES[0].input, {
      generate: fakeGemini(respondFromFixtures).generate,
      cache: brokenCache,
      catalogue: fakeCatalogue(),
    });

    assert.equal(result.record.canonicalKey, 'morrison-boyd-organic-chemistry-3');
    assert.ok(result.warnings.some((w) => w.includes('cache')));
  });
});

describe('canonicalize: when the model misbehaves', () => {
  const input = MESSY_CASES[0].input;

  it('unwraps a markdown fence rather than falling back over backticks', async () => {
    const gemini = fakeGemini(
      () => '```json\n' + JSON.stringify(MESSY_CASES[0].modelOutput) + '\n```',
    );
    const result = await canonicalize(input, { generate: gemini.generate, catalogue: fakeCatalogue() });

    assert.equal(result.source, 'gemini');
    assert.equal(result.record.canonicalKey, 'morrison-boyd-organic-chemistry-3');
  });

  it('falls back to rules on unparseable output', async () => {
    const result = await canonicalize(input, {
      generate: fakeGemini(() => 'I think this might be an organic chemistry textbook?').generate,
      catalogue: emptyCatalogue,
    });

    assert.equal(result.source, 'fallback');
    assert.ok(isSlug(result.record.canonicalKey));
    assert.ok(result.warnings.some((w) => w.includes('Model unavailable')));
  });

  it('falls back when a required field fails validation', async () => {
    const result = await canonicalize(input, {
      generate: fakeGemini(() =>
        JSON.stringify({ ...MESSY_CASES[0].modelOutput, title: '' }),
      ).generate,
      catalogue: emptyCatalogue,
    });

    assert.equal(result.source, 'fallback');
  });

  it('falls back when an edition is out of range', async () => {
    const result = await canonicalize(input, {
      generate: fakeGemini(() =>
        JSON.stringify({ ...MESSY_CASES[0].modelOutput, edition_number: 4000 }),
      ).generate,
      catalogue: emptyCatalogue,
    });

    assert.equal(result.source, 'fallback');
  });

  it('falls back when the request throws', async () => {
    const result = await canonicalize(input, {
      generate: async () => {
        throw new Error('network');
      },
      catalogue: emptyCatalogue,
    });

    assert.equal(result.source, 'fallback');
    assert.equal(result.model, null);
  });

  it('still produces a usable record on the fallback path', async () => {
    const result = await canonicalize('orgo 3rd ed morrison boyd, spine cracked', {
      generate: async () => {
        throw new Error('network');
      },
      catalogue: emptyCatalogue,
    });

    assert.equal(result.record.editionNumber, 3);
    assert.equal(result.record.conditionGuess, 'good');
    assert.ok(result.record.title.toLowerCase().includes('organic chemistry'));
    assert.ok(isSlug(result.record.canonicalKey));
  });

  it('overrides a model-proposed key with the derived one, and says so', async () => {
    const result = await canonicalize(input, {
      generate: fakeGemini(() =>
        JSON.stringify({ ...MESSY_CASES[0].modelOutput, canonical_key: 'Organic Chemistry 3rd!!' }),
      ).generate,
      catalogue: emptyCatalogue,
    });

    assert.equal(result.record.canonicalKey, 'morrison-boyd-organic-chemistry-3');
    assert.ok(result.warnings.some((w) => w.includes('using the derived key')));
  });

  it('reads the edition out of the text when the model returns null', async () => {
    const result = await canonicalize(input, {
      generate: fakeGemini(() =>
        JSON.stringify({ ...MESSY_CASES[0].modelOutput, edition_number: null, edition: null }),
      ).generate,
      catalogue: emptyCatalogue,
    });

    assert.equal(result.record.editionNumber, 3);
    assert.equal(result.record.edition, '3rd ed.');
  });
});

describe('the rules path on its own', () => {
  it('treats an em dash as the start of condition talk', () => {
    const { record } = canonicalizeByRules('campbell bio 12e — hilighted a bit, still fine');
    assert.equal(record.title, 'Campbell Biology');
    assert.equal(record.editionNumber, 12);
    assert.equal(record.canonicalKey, 'campbell-biology-12');
  });

  it('expands the shorthand it knows', () => {
    assert.equal(canonicalizeByRules('orgo 3rd ed, spine cracked').record.title, 'Organic Chemistry');
    assert.equal(canonicalizeByRules('intro to stats 4th ed').record.title, 'Introduction to Statistics');
  });

  it('keeps a title when the text is only a title', () => {
    const { record } = canonicalizeByRules('principles of mathematical analysis');
    assert.equal(record.title, 'Principles of Mathematical Analysis');
    assert.equal(record.editionNumber, null);
    assert.equal(record.canonicalKey, record.workKey);
  });

  it('reads a valid ISBN out and keeps it out of the title', () => {
    const { record } = canonicalizeByRules('campbell biology 978-0-13-409341-3 good shape');
    assert.equal(record.isbn13, '9780134093413');
    assert.ok(!record.title.includes('978'));
  });

  it('says so when it cannot find a title at all', () => {
    const { record, warnings } = canonicalizeByRules('3rd ed, taped');
    assert.equal(record.title, 'Untitled Listing');
    assert.ok(warnings.some((w) => w.includes('No title')));
  });

  it('never doubles the period after an edition label', () => {
    const text = describeByRules({
      title: 'Organic Chemistry',
      authors: [],
      edition: '3rd ed.',
      condition: 'good',
    });
    assert.ok(!text.includes('..'), text);
  });
});

describe('canonicalize: input the flow should refuse', () => {
  const cases = ['', '   ', 'ok', '??'];

  for (const input of cases) {
    it(`refuses ${JSON.stringify(input)} without calling the model`, async () => {
      const gemini = fakeGemini(respondFromFixtures);
      await assert.rejects(
        () => canonicalize(input, { generate: gemini.generate }),
        InputTooThinError,
      );
      assert.equal(gemini.calls.length, 0);
    });
  }

  it('refuses a pasted chapter', async () => {
    await assert.rejects(() => canonicalize('a'.repeat(1001)), InputTooThinError);
  });
});

describe('a student correcting the model', () => {
  it('writes the correction back to the cache and pins it', async () => {
    const cache = new InMemoryCache();
    const gemini = fakeGemini(respondFromFixtures);
    const input = MESSY_CASES[1].input;

    const resolved = await canonicalize(input, { generate: gemini.generate, cache, catalogue: fakeCatalogue() });

    const corrected = await applyHumanOverride({
      rawInput: input,
      current: resolved.record,
      correction: { editionNumber: 11, title: 'Campbell Biology' },
      userId: '00000000-0000-0000-0000-0000000000aa',
      cache,
    });

    assert.equal(corrected.source, 'human');
    assert.equal(corrected.record.editionNumber, 11);
    assert.equal(corrected.record.canonicalKey, 'urry-campbell-biology-11');

    // The next person typing the same thing gets the corrected record, free.
    const next = await canonicalize(input, { generate: gemini.generate, cache, catalogue: fakeCatalogue() });
    assert.equal(next.source, 'human');
    assert.equal(next.record.editionNumber, 11);
    assert.equal(gemini.calls.length, 1);
  });

  it('lets a student point at an existing book instead of editing fields', async () => {
    const cache = new InMemoryCache();
    const resolved = await canonicalize('some obscure phrasing of campbell 12', {
      generate: fakeGemini(() => JSON.stringify(MESSY_CASES[1].modelOutput)).generate,
      cache,
      catalogue: fakeCatalogue(),
    });

    const corrected = await applyHumanOverride({
      rawInput: 'some obscure phrasing of campbell 12',
      current: resolved.record,
      correction: { canonicalKey: 'campbell-biology-12', workKey: 'campbell-biology' },
      userId: '00000000-0000-0000-0000-0000000000aa',
      cache,
    });

    assert.equal(corrected.record.canonicalKey, 'campbell-biology-12');
    assert.equal(corrected.matchedExistingBook, true);
  });

  it('does not let automated output overwrite a correction', async () => {
    const cache = new InMemoryCache();
    const input = MESSY_CASES[0].input;
    const first = await canonicalize(input, {
      generate: fakeGemini(respondFromFixtures).generate,
      cache,
      catalogue: fakeCatalogue(),
    });

    await applyHumanOverride({
      rawInput: input,
      current: first.record,
      correction: { title: 'Organic Chemistry (Morrison and Boyd)' },
      userId: '00000000-0000-0000-0000-0000000000aa',
      cache,
    });

    await cache.put({
      inputHash: hashInput(input),
      rawInput: input,
      normalizedInput: normalizeInput(input),
      record: first.record,
      canonicalKey: first.record.canonicalKey,
      model: 'gemini-2.5-flash-lite',
      source: 'gemini',
    });

    const entry = await cache.get(hashInput(input));
    assert.equal(entry?.source, 'human');
    assert.equal(entry?.record.title, 'Organic Chemistry (Morrison and Boyd)');
  });
});
