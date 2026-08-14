/**
 * Runs the canonicalization pipeline against the real Gemini API.
 *
 *   GEMINI_API_KEY=... npm run canon -- "orgo 3rd ed morrison boyd, spine cracked"
 *   GEMINI_API_KEY=... npm run canon            # runs all ten fixture inputs
 *
 * Without a key it still runs, and every listing takes the rules-based path —
 * which is the point of the rules-based path.
 *
 * This talks to no database. The cache is in-process, so running the same
 * string twice in one invocation shows the cache working.
 */
import { canonicalize } from '../lib/canonicalize/canonicalize';
import { enrich } from '../lib/canonicalize/enrich';
import { hasGeminiKey } from '../lib/ai/gemini';
import { GEMINI_MODEL } from '../lib/ai/model';
import { InMemoryCache } from '../lib/canonicalize/ports';
import { MESSY_CASES } from '../tests/fixtures/messy-inputs';

const DIM = '[2m';
const BOLD = '[1m';
const RESET = '[0m';

async function main(): Promise<void> {
  const args = process.argv.slice(2).filter((a) => !a.startsWith('-'));
  const inputs = args.length > 0 ? args : MESSY_CASES.map((c) => c.input);
  const cache = new InMemoryCache();

  console.log(`${BOLD}model${RESET}  ${GEMINI_MODEL}`);
  console.log(
    `${BOLD}key${RESET}    ${hasGeminiKey() ? 'present' : 'absent — every listing will take the rules path'}`,
  );
  console.log();

  for (const input of inputs) {
    const started = Date.now();
    try {
      const result = await canonicalize(input, { cache });
      const elapsed = Date.now() - started;

      console.log(`${BOLD}${input}${RESET}`);
      console.log(`  key        ${result.record.canonicalKey}`);
      console.log(`  work       ${result.record.workKey}`);
      console.log(`  title      ${result.record.title}`);
      console.log(`  authors    ${result.record.authors.join(', ') || '—'}`);
      console.log(`  edition    ${result.record.edition ?? '—'}`);
      console.log(`  condition  ${result.record.conditionGuess ?? '—'}`);
      console.log(`  source     ${result.source}${result.model ? ` (${result.model})` : ''}  ${DIM}${elapsed}ms${RESET}`);

      for (const warning of result.warnings) {
        console.log(`  ${DIM}warn       ${warning}${RESET}`);
      }

      const enriched = await enrich({
        title: result.record.title,
        authors: result.record.authors,
        edition: result.record.edition,
        editionNumber: result.record.editionNumber,
        subjectTags: result.record.subjectTags,
        condition: result.record.conditionGuess ?? 'good',
        notes: null,
        courseCodes: [],
      });

      console.log(`  tags       ${enriched.tags.join(' ')}`);
      console.log(`  copy       ${enriched.description}`);
      console.log(`  ${DIM}enriched via ${enriched.source}${RESET}`);
      for (const warning of enriched.warnings) {
        console.log(`  ${DIM}warn       ${warning}${RESET}`);
      }
    } catch (error) {
      console.log(`${BOLD}${input}${RESET}`);
      console.log(`  refused    ${error instanceof Error ? error.message : String(error)}`);
    }
    console.log();
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
