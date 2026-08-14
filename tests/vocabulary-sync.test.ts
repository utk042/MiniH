import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it } from 'node:test';
import { CONTROLLED_TAGS, TAG_FACETS, TAG_VOCABULARY } from '../lib/tags/vocabulary';

/**
 * The vocabulary exists in two places — TypeScript, because the prompt and the
 * validator need it, and Postgres, because the UI filters on it. Two copies of
 * a list drift. This is the test that stops them.
 */

const MIGRATION = join(
  import.meta.dirname,
  '..',
  'supabase',
  'migrations',
  '20260814000700_catalogue_resolution.sql',
);

function tagsFromMigration(): Array<{ tag: string; facet: string }> {
  const sql = readFileSync(MIGRATION, 'utf8');
  const insert = sql.slice(sql.indexOf('insert into public.tag_vocabulary'));
  return [...insert.matchAll(/\('([a-z0-9-]+)',\s*'([a-z]+)'\)/g)].map(([, tag, facet]) => ({
    tag,
    facet,
  }));
}

describe('the tag vocabulary is the same in TypeScript and in Postgres', () => {
  const rows = tagsFromMigration();

  it('has the same terms in both', () => {
    assert.deepEqual(
      rows.map((r) => r.tag).sort(),
      [...CONTROLLED_TAGS].sort(),
    );
  });

  it('files each term under the same facet in both', () => {
    for (const { tag, facet } of rows) {
      assert.ok(
        TAG_VOCABULARY[facet as (typeof TAG_FACETS)[number]]?.includes(tag),
        `${tag} is '${facet}' in the migration but not in lib/tags/vocabulary.ts`,
      );
    }
  });

  it('has no duplicates in the migration', () => {
    const tags = rows.map((r) => r.tag);
    assert.equal(new Set(tags).size, tags.length);
  });

  it("uses only facets the check constraint on the table allows", () => {
    for (const { facet } of rows) {
      assert.ok(TAG_FACETS.includes(facet as (typeof TAG_FACETS)[number]), facet);
    }
  });
});
