import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';
import { enrich, normalizeTags, validateDescription, validateTags } from '../lib/canonicalize/enrich';
import { describeByRules } from '../lib/canonicalize/fallback';
import { CONTROLLED_TAGS, isControlledTag, TAG_RULES } from '../lib/tags/vocabulary';
import { fakeGemini } from './fixtures/messy-inputs';

const BOOK = {
  title: 'Organic Chemistry',
  authors: ['Robert T. Morrison', 'Robert N. Boyd'],
  edition: '3rd ed.',
  editionNumber: 3,
  subjectTags: ['chemistry', 'organic-chemistry'],
  condition: 'good',
  notes: 'Spine cracked, pencil notes in chapters 4 to 7.',
  courseCodes: ['CHEM 241'],
};

const GOOD_RESPONSE = JSON.stringify({
  tags: ['chemistry', 'organic-chemistry', 'upper-division', 'edition-sensitive'],
  description:
    'Organic Chemistry by Morrison and Boyd, 3rd edition, the text used in CHEM 241. The spine is cracked and there are pencil notes in chapters 4 to 7.',
});

describe('enrich', () => {
  it('returns tags and a description from a single call', async () => {
    const gemini = fakeGemini(() => GOOD_RESPONSE);
    const result = await enrich(BOOK, { generate: gemini.generate });

    assert.equal(gemini.calls.length, 1, 'tags and description must not cost two calls');
    assert.equal(result.source, 'gemini');
    assert.ok(result.tags.length >= TAG_RULES.min && result.tags.length <= TAG_RULES.max);
    assert.ok(result.description.length > 0);
  });

  it('asks for both in one prompt', async () => {
    const gemini = fakeGemini(() => GOOD_RESPONSE);
    await enrich(BOOK, { generate: gemini.generate });

    const prompt = gemini.calls[0];
    assert.ok(prompt.includes('TAGS:'));
    assert.ok(prompt.includes('DESCRIPTION:'));
  });

  it('gives the model the controlled vocabulary', async () => {
    const gemini = fakeGemini(() => GOOD_RESPONSE);
    await enrich(BOOK, { generate: gemini.generate });

    assert.ok(gemini.calls[0].includes('organic-chemistry'));
    assert.ok(gemini.calls[0].includes('upper-division'));
  });

  it('falls back to deterministic tags and copy when the call fails', async () => {
    const result = await enrich(BOOK, {
      generate: async () => {
        throw new Error('network');
      },
    });

    assert.equal(result.source, 'fallback');
    assert.ok(result.tags.length > 0);
    assert.equal(validateDescription(result.description), null);
  });

  it('rejects a description that reads like a product page', async () => {
    const result = await enrich(BOOK, {
      generate: fakeGemini(() =>
        JSON.stringify({
          tags: ['chemistry', 'organic-chemistry', 'upper-division', 'exam-prep'],
          description: 'Elevate your studies with this must-have classic of the discipline.',
        }),
      ).generate,
    });

    assert.equal(result.source, 'fallback');
    assert.ok(result.warnings[0].includes('marketing language'));
  });

  it('rejects a description that runs to three sentences', async () => {
    const result = await enrich(BOOK, {
      generate: fakeGemini(() =>
        JSON.stringify({
          tags: ['chemistry', 'organic-chemistry', 'upper-division', 'exam-prep'],
          description: 'One sentence here. Two sentences here. Three is too many.',
        }),
      ).generate,
    });

    assert.equal(result.source, 'fallback');
    assert.ok(result.warnings[0].includes('3 sentences'));
  });

  it('rejects emoji and exclamation marks', async () => {
    for (const description of ['Solid copy of the text 📚', 'A clean copy of the third edition!']) {
      const result = await enrich(BOOK, {
        generate: fakeGemini(() =>
          JSON.stringify({
            tags: ['chemistry', 'organic-chemistry', 'upper-division', 'exam-prep'],
            description,
          }),
        ).generate,
      });
      assert.equal(result.source, 'fallback', description);
    }
  });

  it('trims an over-eager tag list to the best eight', async () => {
    const result = await enrich(BOOK, {
      generate: fakeGemini(() =>
        JSON.stringify({
          tags: [
            'chemistry', 'organic-chemistry', 'upper-division', 'edition-sensitive',
            'hardcover', 'exam-prep', 'mcat-prep', 'paperback', 'annotated',
            'sophomore-year', 'cheap', 'great-deal', 'must-buy',
          ],
          description: 'Organic Chemistry by Morrison and Boyd, 3rd edition. The spine is cracked.',
        }),
      ).generate,
    });

    assert.equal(result.source, 'gemini');
    assert.equal(result.tags.length, TAG_RULES.max);
    assert.ok(result.tags.every((t) => isControlledTag(t) || TAG_RULES.freeTagPattern.test(t)));
  });

  it('falls back when almost nothing is from the vocabulary', async () => {
    const result = await enrich(
      { ...BOOK, subjectTags: [], courseCodes: [] },
      {
        generate: fakeGemini(() =>
          JSON.stringify({
            tags: ['sophomore-year', 'cheap-textbook', 'orange-cover', 'heavy-book'],
            description: 'A used chemistry textbook. The spine is cracked.',
          }),
        ).generate,
      },
    );

    assert.equal(result.source, 'fallback');
  });
});

describe('tag rules', () => {
  it('keeps controlled tags ahead of free ones', () => {
    const tags = normalizeTags(
      ['sophomore-year', 'chemistry', 'orange-cover', 'organic-chemistry', 'upper-division'],
      { ...BOOK },
    );
    assert.deepEqual(tags.slice(0, 3), ['chemistry', 'organic-chemistry', 'upper-division']);
  });

  it('caps free tags', () => {
    const tags = normalizeTags(
      ['chemistry', 'organic-chemistry', 'a-one', 'b-two', 'c-three', 'd-four', 'e-five'],
      { ...BOOK },
    );
    const free = tags.filter((t) => !isControlledTag(t));
    assert.ok(free.length <= TAG_RULES.maxFree, `${free.length} free tags`);
  });

  it('drops anything that is not a lowercase slug', () => {
    const tags = normalizeTags(['Chemistry', 'organic chemistry', 'ORGANIC_CHEM', 'organic-chemistry'], {
      ...BOOK,
    });
    assert.ok(tags.every((t) => TAG_RULES.freeTagPattern.test(t)));
    assert.ok(tags.includes('chemistry'));
    assert.ok(tags.includes('organic-chemistry'));
  });

  it('tops up from what we already know rather than returning three tags', () => {
    const tags = normalizeTags(['chemistry', 'organic-chemistry'], { ...BOOK });
    assert.ok(tags.length >= TAG_RULES.min);
    assert.equal(validateTags(tags), null);
  });

  it('every controlled tag is a valid slug', () => {
    for (const tag of CONTROLLED_TAGS) {
      assert.ok(TAG_RULES.freeTagPattern.test(tag), tag);
    }
  });
});

describe('the deterministic description', () => {
  it('states the book and the copy, and nothing else', () => {
    const text = describeByRules({
      title: 'Organic Chemistry',
      authors: ['Robert T. Morrison', 'Robert N. Boyd'],
      edition: '3rd ed.',
      condition: 'good',
      notes: 'Spine cracked, no highlighting.',
      courseCodes: ['CHEM 241'],
    });

    assert.equal(validateDescription(text), null, text);
    assert.ok(text.includes('Organic Chemistry'));
    assert.ok(text.includes('good condition'));
  });

  it('works with no authors and no notes', () => {
    const text = describeByRules({
      title: 'Untitled Listing',
      authors: [],
      edition: null,
      condition: 'fair',
    });
    assert.equal(validateDescription(text), null, text);
  });

  it('passes its own validator for every condition', () => {
    for (const condition of ['poor', 'fair', 'good', 'like_new', 'new']) {
      const text = describeByRules({
        title: 'Campbell Biology',
        authors: ['Lisa A. Urry'],
        edition: '12th ed.',
        condition,
        notes: 'Highlighting through the genetics unit.',
      });
      assert.equal(validateDescription(text), null, `${condition}: ${text}`);
    }
  });
});

describe('validateDescription', () => {
  const rejected: Array<[string, string]> = [
    ['Elevate your studies with this classic text.', 'marketing language'],
    ['Seamlessly covers the whole syllabus.', 'marketing language'],
    ['A clean copy of the third edition!', 'exclamation mark'],
    ['Great book 🔥', 'emoji'],
    ['One. Two. Three.', '3 sentences'],
    ['This is perfect for your organic chemistry course.', 'marketing language'],
    ['', 'empty description'],
  ];

  for (const [description, reason] of rejected) {
    it(`rejects ${JSON.stringify(description.slice(0, 40))}`, () => {
      const problem = validateDescription(description);
      assert.ok(problem, 'expected a rejection');
      assert.ok(problem.includes(reason), `${problem} should mention ${reason}`);
    });
  }

  it('accepts plain factual copy', () => {
    assert.equal(
      validateDescription(
        'Principles of Economics by N. Gregory Mankiw, 9th edition. There is water damage along the bottom edge and the text is legible.',
      ),
      null,
    );
  });
});
