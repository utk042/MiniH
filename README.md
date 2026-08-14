# BACKSTACK

A peer-to-peer textbook exchange for one college campus. Demand-first and
swap-first: instead of posting an item and waiting for a buyer, every student
keeps two lists — a **shelf** of books they hold and a list of **wants** driven
by next semester's course codes — and the system looks for trades between them.

It finds three things, in this order:

1. **Direct swaps.** I have what you want, you have what I want.
2. **Cycles of three and four.** A gives to B, B gives to C, C gives back to A.
   Nobody would ever find these with a search bar. This is the point of the
   project.
3. **Cash**, only when no cycle exists, with a suggested price computed from
   campus comparables.

---

## Status

**Steps 1 and 2 of 5 are complete.** Step 1: schema, RLS, matching functions and
seed data. Step 2: the canonicalization pipeline — Gemini, cache, Zod, and a
rules-based fallback. Nothing below is a mock; every function, policy and
prompt described here runs.

Still to build, in order: the UI, then realtime and messaging. The 60-second
demo script belongs with the UI and is not written yet — there is no interface
to click through.

```
npm run verify        # typecheck, then the TypeScript tests, then the database
```

```
# tests 121
# pass 121

   pass  01_campus_domain_and_signup.sql  (14 assertions)
   pass  02_rls.sql  (32 assertions)
   pass  03_cycles.sql  (30 assertions)
   pass  04_cash_fallback_and_pricing.sql  (17 assertions)
   pass  05_new_listing_creates_a_match.sql  (12 assertions)
   pass  06_catalogue_resolution.sql  (22 assertions)
   pass  key derivation matches in both languages  (100 assertions)
```

**One thing these numbers do not cover:** no call has been made to the real
Gemini API. There is no key in this environment. The tests drive the pipeline
through an injected transport, which exercises our validation, derivation,
caching and fallback but says nothing about how well the model itself resolves
"orgo 3rd ed morrison boyd". `npm run canon` is the script that answers that,
and it needs `GEMINI_API_KEY`.

## Running the verification

`npm run db:verify` builds a throwaway Postgres 16 cluster in a temp directory,
applies the migrations verbatim, loads the seed, runs the tests, and deletes the
cluster. It never touches a Supabase project, and it needs no Docker daemon and
no Supabase CLI — only the Postgres 16 server binaries (`/usr/lib/postgresql/16`
by default; override with `PGBIN`).

| Command                     | What it does                                        |
| --------------------------- | --------------------------------------------------- |
| `npm run db:verify`         | Build, test, tear down.                              |
| `npm run db:verify:keep`    | Same, but leave the cluster up and print a `psql` line. |
| `BACKSTACK_VERBOSE=1 …`     | Print every assertion, not just the per-file count.  |

Supabase provides `auth`, `storage`, the `anon` / `authenticated` /
`service_role` roles and the `supabase_realtime` publication. A bare cluster
does not, so `supabase/local/00_auth_shim.sql` recreates the smallest faithful
version of each — including `auth.uid()` reading `request.jwt.claims` exactly as
PostgREST sets it. **The shim is local only and is never applied to a project.**
It exists so RLS can be tested the way it will actually be exercised: as the
`authenticated` role with a `sub` claim, not as a superuser.

### Applying to a real project

With the Supabase CLI: `supabase db reset` (config.toml runs the seed) or
`supabase db push`.

Without it: `SUPABASE_DB_URL=postgresql://… npm run db:push -- --seed`.

---

## The data model

```
profiles ──< copies >── books ──< wants >── profiles
                 │        │         │
                 └──── match_edges (view) ─────┘
                            │
                    find_swap_cycles()
                            │
              matches ──< match_legs >── copies
                 │
              messages
```

| Table                    | What it holds                                                             |
| ------------------------ | ------------------------------------------------------------------------- |
| `profiles`               | One per account, provisioned by trigger on signup. Handle, display name, pickup spot. |
| `books`                  | The canonical record, deduped on `canonical_key`. Also carries `work_key`, the edition-agnostic prefix. |
| `copies`                 | One physical book someone holds: condition, notes, ask price, photo, status. |
| `wants`                  | User + `canonical_key` + priority + `edition_strict`.                     |
| `matches` / `match_legs` | Materialized trades. One leg per hand-off.                                |
| `messages`               | One thread per match. There is no messaging outside a proposed trade.     |
| `cache_canonicalization` | Keyed by hash of the normalised input, so the same string costs zero API calls twice. |
| `app_config`             | Runtime settings. The campus email domain lives here.                     |

### Two ideas worth explaining

**`canonical_key` and `work_key`.** `canonical_key` identifies an exact edition
(`morrison-boyd-organic-chemistry-3`); `work_key` identifies the work across
editions (`morrison-boyd-organic-chemistry`). A check constraint requires the
former to extend the latter, so edition-tolerant matching can never link two
unrelated books. A want matches an exact key first; if the want is not
`edition_strict`, a different edition of the same work also matches, at a lower
score, and every trade that relies on one is flagged `all_exact = false`.

**Condition score.** `poor`…`new` maps to 1…5 through an immutable function that
backs a stored generated column, so ranking never has to interpret an enum.

---

## The matching engine

An edge `giver → receiver` exists when the giver holds an open copy the receiver
has an active want for. A trade is a simple directed cycle over those edges:
every participant gives exactly one copy and receives exactly one copy. Length 2
is a direct swap; 3 and 4 are the interesting cases. Depth is capped at four
participants regardless of what the caller asks for.

The whole search is one recursive CTE in
`supabase/migrations/20260814000500_matching.sql`. No part of it runs in
JavaScript.

Two details that matter:

- **Every cycle is anchored at its numerically smallest participant.** A cycle
  therefore has exactly one representation, so rotations of the same trade never
  come back as separate results and no de-duplication pass is needed. There is a
  test for it.
- **The search walks one best edge per ordered pair** (`match_edges_best`),
  which keeps the recursion small and the output deterministic. The full edge
  list is still there to explain a match afterwards.

Results are ordered shortest cycle first — fewer people to coordinate — then by
total condition.

| Function                              | Does                                                            |
| ------------------------------------- | --------------------------------------------------------------- |
| `find_swap_cycles(user, depth, limit)`| The cycle search. `user` filters to trades that person is in.   |
| `find_cash_offers(user, limit)`       | Buy/sell fallback, excluding wants a cycle already covers.      |
| `suggest_price_cents(book, condition)`| Campus median for that book, else list price × condition factor. Returns null rather than inventing a number. |
| `book_demand(canonical_key)`          | How many people want it. A count, never a list of names.        |
| `materialize_matches(limit)`          | Refreshes `matches`/`match_legs`. Idempotent.                   |
| `respond_to_match(match, status)`     | Accept / decline / complete, participants only.                 |

`materialize_matches` also expires trades whose copies have left the pool, and
revives the same row — same id, same thread — if the copy comes back. Both are
tested.

---

## Canonicalization

Free text in, one canonical record out:

```
  normalise + hash the input
        |
  cache hit? ──yes──> return, zero API calls
        | no
  Gemini: extract {title, authors, edition, subject_tags, condition, isbn}
        |
  Zod ──fails──> rules-based fallback (deterministic, always available)
        |
  derive canonical_key IN CODE from {authors, title, edition}
        |
  resolve against the catalogue — does this book already have a node?
        |
  write the cache
```

### Where the model is, and is not

Gemini does three narrow jobs: it reads free text into structured fields, it
picks tags, and it writes two sentences of description. It does not rank
matches, set prices, search for cycles, or write messages — those are
deterministic SQL and TypeScript, in `20260814000500_matching.sql` and
`suggest_price_cents()`.

It also does not decide a `canonical_key`. The model is asked for one, and the
answer is used only as a cross-check: the key that gets written is always the
one `deriveKeys()` computes from `{authors, title, edition}`. A model that is
right 99% of the time still fragments the graph 1% of the time, and a fragmented
graph finds no cycles. When the two disagree, the derived key wins and the
disagreement is surfaced as a warning next to the "resolved by AI" affordance.

The model id lives in exactly one place, `lib/ai/model.ts`:

```ts
export const GEMINI_MODEL = 'gemini-2.5-flash-lite';
```

Calls set `responseMimeType: 'application/json'` with a `responseSchema`, and
`temperature: 0` — this is extraction, so the same listing must resolve the same
way twice. There is still a fence-stripping parser behind that, because a stray
```` ```json ```` is the most common way structured output fails and falling
back over a pair of backticks would be silly.

### Deterministic keys, and the catalogue that overrides them

`canonical_key` is derived by rule: author surnames, then title, then edition.
One author gives one surname, two give both, three or more give the first only —
so `morrison-boyd-organic-chemistry-3`, and `cormen-introduction-to-algorithms-4`
rather than a key naming all four of CLRS.

Derivation alone is not enough. The campus catalogue calls one book
`campbell-biology-12`; no rule reading `{Urry, Cain, Wasserman}` will ever
produce that. So before minting a key, `resolve_book()` looks for the book
already in the catalogue — by ISBN, or by title plus edition plus a shared
author surname. Five of the ten test listings derive straight to the seeded key;
the other five only land on the right node because of this lookup.

Resolution is deliberately conservative. A false match merges two different
books permanently; a missed match only leaves a duplicate someone can merge
later. "Organic Chemistry" by Morrison and "Organic Chemistry" by McMurry stay
apart, and there is a test for it.

**The two implementations must agree.** `canonicalize()` computes `title_key` in
TypeScript and hands it to `resolve_book()`, which compares it against a column
generated in SQL. If they ever disagree — on an accent, a leading article,
punctuation — nothing errors. Resolution silently stops matching, every listing
mints a fresh node, and the graph quietly stops finding cycles. So
`scripts/db/parity.ts` runs both implementations over the same 100 awkward
inputs and asserts they agree, as part of `npm run db:verify`. It has already
caught two real divergences: `lower()` not folding `Æ` under a C locale, and
Postgres resolving mixed greedy/non-greedy quantifiers differently from
JavaScript on "Ludwig van Beethoven".

### Cost discipline

| Measure | Effect |
| --- | --- |
| Cache keyed by hash of the normalised input | The same string twice costs nothing. Case, spacing and curly quotes normalise away first, so near-misses hit too. |
| Tags and description in one call | Not two. There is a test asserting the call count. |
| In-process single-flight | Two people pasting the same string at the same moment is one call. |
| Human corrections written back | A correction is cached under the same hash and marked `human`, so it is free forever after, and a trigger stops automated output from overwriting it. |

### When it goes wrong

Nothing in the flow throws because an API did. Unparseable output, a failed Zod
check, a timeout, a missing key — all land on `canonicalizeByRules()`, which
expands the shorthand it knows, reads the edition and condition out of the text,
and mints a title-only key. It is worse than the model and says so: every record
it produces carries warnings, including that no author was identified.

The tag and description validators are house rules, not just shapes. A
description is rejected for a third sentence, an exclamation mark, an emoji,
addressing the reader, or any of two dozen marketing phrases — "elevate",
"perfect for", "must-have". A rejected description is replaced by the
deterministic one rather than retried, because a retry costs another call to fix
a prompt problem.

### Trying it

```
GEMINI_API_KEY=... npm run canon -- "orgo 3rd ed morrison boyd, spine cracked"
GEMINI_API_KEY=... npm run canon          # all ten fixture listings
npm run canon                             # no key: everything takes the rules path
```

---

## Security

Every table has RLS enabled, scoped `to authenticated`. The shape:

| Table          | Read                                    | Write                          |
| -------------- | --------------------------------------- | ------------------------------ |
| `profiles`     | everyone on campus                      | your own row                   |
| `books`        | everyone on campus                      | insert freely; edit what you created |
| `copies`       | open copies, plus all of your own       | your own                       |
| `wants`        | **your own only**                       | your own                       |
| `matches`      | participants only                       | server functions only          |
| `messages`     | participants only                       | post as yourself, into your own threads |
| `cache_…`      | everyone (that is the point of a cache) | insert; corrections signed by you |

Three decisions worth defending:

**Wants are private.** What you need next semester reveals your course
schedule. Other people's wants surface only through a match, or as an anonymous
count from `book_demand()`. The consequence is that `match_edges` joins private
rows, so the view is deliberately left ungranted and reachable only through
`SECURITY DEFINER` functions. A signed-in student selecting from it gets
`permission denied`, and there is a test asserting exactly that.

**The campus domain is a database constraint.** A `BEFORE INSERT` trigger on
`auth.users` refuses any address outside the configured domain, so a magic link
requested for a gmail address fails no matter which client asked. The domain
lives in `app_config`, not in the trigger body — `select
public.set_allowed_email_domain('yourcampus.edu')` changes it with no migration.
Tests cover look-alike domains (`westfield.edu.attacker.test`) and the domain
appearing in the local part.

**RLS says which rows, triggers say which columns.** Message bodies are
immutable — a recipient may set `read_at` and nothing else. A cached
canonicalization corrected by a human cannot be overwritten by automated output;
human override always wins.

---

## Seed data

25 students, 61 canonical books, 73 copies, 61 wants, all deterministic (ids are
derived by hash from the handle, so the file is re-runnable against a fresh
database). The graph produces **34 trades: 15 direct swaps, 8 three-ways and 11
four-ways.**

Six situations are constructed by hand so the demo never depends on luck, and
each has a test:

| Constructed case            | Why                                                       |
| --------------------------- | --------------------------------------------------------- |
| ada.chen → bo.mensah → cy.okafor → ada | The guaranteed three-way.                      |
| dee.laurent → eli.novak → fern.abbott → gus.iversen → dee | The guaranteed four-way. |
| hana.suzuki ↔ ike.brennan   | A plain direct swap.                                       |
| kira.osei ↔ jun.park        | A first edition filling a want for the second — an inexact trade, flagged as such. |
| lena.ortiz                  | A strict-edition want that must *not* match the 8th edition on someone's shelf. The test also relaxes it and checks the edge appears. |
| nia.walsh                   | Books other people want, but no return path inside four hops, so her want resolves to cash. `05_new_listing…` then has her list one book and watches the cash offer turn into a swap. |

The other 18 students carry organic shelves and wants, which is where the other
28 trades come from. A match list containing only the staged trades would look
staged.

---

## Layout

```
lib/
  ai/
    model.ts                                   GEMINI_MODEL and the call limits
    gemini.ts                                  the transport, behind an injectable seam
  canonicalize/
    canonicalize.ts                            the orchestrator
    enrich.ts                                  tags + description, one call
    fallback.ts                                the rules-based path
    normalize.ts                               normalisation and hashing
    override.ts                                a student correcting the model
    ports.ts                                   cache and catalogue interfaces
    prompts.ts                                 both prompts
    schema.ts                                  Zod + responseSchema
    slug.ts                                    key derivation. deterministic, no model
    supabase-repos.ts                          the two ports, against Supabase
  tags/vocabulary.ts                           the controlled tag list
supabase/
  migrations/
    20260814000100_config_and_types.sql        app_config, enums, slugify, condition_score
    20260814000200_core_tables.sql             the eight tables
    20260814000300_campus_domain_and_signup.sql  domain trigger, profile provisioning
    20260814000400_rls.sql                     policies + column-level guards
    20260814000500_matching.sql                edges, cycle search, pricing, materialization
    20260814000600_storage_and_realtime.sql    photo bucket, publication
    20260814000700_catalogue_resolution.sql    resolve_book, title_key, tag vocabulary
  seed.sql
  config.toml
  local/00_auth_shim.sql                       local verification only
  tests/                                       _helpers.sql + six test files
scripts/
  canon.ts                                     run the pipeline against the real API
  db/verify.sh                                 build a cluster, apply, test, tear down
  db/parity.ts                                 assert TypeScript and SQL derive the same keys
  db/push.sh                                   apply to a real database
tests/                                         121 TypeScript tests
  fixtures/messy-inputs.ts                     the ten listings, and a fake catalogue
```

---

## Environment

Every variable is in `.env.example`. `GEMINI_API_KEY` is read in exactly one
place, `lib/ai/gemini.ts`, which is server-only and must never be imported from
a client component. `NEXT_PUBLIC_CAMPUS_EMAIL_DOMAIN` must match the value in
`app_config`, where the trigger reads it from.

The pipeline runs under the signed-in student's own Supabase session, not the
service role: `cache_canonicalization` and `books` are insertable by
`authenticated` on purpose, so canonicalization needs no elevated key at all.
