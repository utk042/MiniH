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

**Steps 1, 2 and 4 of 5 are complete.** Step 1: schema, RLS, matching functions
and seed data. Step 2: the canonicalization pipeline — Gemini, cache, Zod, and a
rules-based fallback. Step 4: the UI — sign-in, browse, shelf, wants, matches,
and the cycle diagram. Nothing here is a mock; every page reads through
`lib/data/` and RLS, every mutation goes through `app/actions/` and the
canonicalization pipeline.

Still to build: realtime (step 5 — a new listing lighting up existing matches
live, in the browser, without a refresh; the trigger that recomputes matches on
the database side already exists, from step 4). Messaging exists today as a
plain per-match thread with no live delivery yet. The 60-second demo script
belongs with the finished realtime layer and is not written yet.

```
npm run verify        # typecheck, TypeScript tests, database, next build
```

```
# tests 121
# pass 121

   pass  01_campus_domain_and_signup.sql  (14 assertions)
   pass  02_rls.sql  (32 assertions)
   pass  03_cycles.sql  (34 assertions)
   pass  04_cash_fallback_and_pricing.sql  (17 assertions)
   pass  05_new_listing_creates_a_match.sql  (13 assertions)
   pass  06_catalogue_resolution.sql  (22 assertions)
   pass  key derivation matches in both languages  (100 assertions)

Route (app)
┌ ○ /                    ○ /matches          ƒ /sign-in
├ ƒ /auth/callback        ƒ /matches/[id]     ○ /wants
├ ○ /browse               ○ /shelf
└ ƒ /browse/[id]
```

**Two things these numbers do not cover.** No call has been made to the real
Gemini API — there is no key in this environment; `npm run canon -- "..."`
exercises that half. And no page has been driven by a real signed-in session —
there is no live Supabase project here, so GoTrue and PostgREST are
unreachable. What *was* checked against a running `next dev`: every
unauthenticated redirect, the sign-in page's honest "no database configured"
notice, the 404 and error boundaries, and — because a screenshot is the only
way to actually see an SVG — the cycle diagram and the list-detail shell,
rendered with fixture data on a throwaway route that was deleted afterward.
That check caught a real bug: see the `CycleView` note under **The cycle
view**, below.

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

## The UI

Next.js App Router, no service-role key anywhere in the app — every page and
every mutation runs under the signed-in student's own Supabase session,
authenticated via `@supabase/ssr`, scoped by the RLS policies from step 1.
`proxy.ts` (Next 16's replacement for `middleware.ts`) refreshes that session on
every request; auth gating itself happens per-page, in `requireProfile()`.

| Route | What it is |
| --- | --- |
| `/sign-in` | Magic link. Checks the campus domain client-side for a fast, kind failure — the trigger from step 1 is what actually enforces it. |
| `/browse`, `/browse/[copyId]` | List-detail index of every open copy, alphabetical by title. CSS-only mobile drill-in: both panes stay in the DOM, a media query hides one or the other. |
| `/shelf` | Your copies, and the two-step listing flow. |
| `/wants` | Your wants — private, per step 1's RLS — and the same two-step flow, without enrichment (a want has no description to write). |
| `/matches`, `/matches/[matchId]` | Swap cycles with the diagram, a plain-language leg-by-leg breakdown, accept/decline/complete, and a message thread. Cash fallback offers list below, unclickable — there is no match row for a cash trade to attach to. |

### The two-step listing flow

Both `/shelf` and `/wants` work the same way, because canonicalization is a
network call and a review step, not a single form submit:

1. The student types free text. A server action (`resolveListingDraft` /
   `resolveWantDraft`) runs it through `canonicalize()` (and, for a listing,
   `enrich()`) and returns a structured draft.
2. The draft renders as an editable review card — title, tags, description,
   condition, price — with an `ai-badge` showing where it came from ("resolved
   by AI", "resolved without the model", "seen before, resolved instantly") and
   any warnings from the pipeline.
3. The student edits what's wrong and submits. A second server action
   (`createCopyListing` / `createWant`) writes it. If the title changed, the
   correction goes through `applyHumanOverride()` first — cached under the same
   input hash, so the next person who types that string gets the fix for free,
   not just this one listing.

### The cycle view

`components/CycleView.tsx` is a **server component** — the brief's "animate it
once on reveal" needs no client JavaScript at all. A CSS keyframe animation on
a freshly mounted DOM node plays once, automatically, whether that mount came
from a first page load or a Next.js client-side navigation to a different
match. No `IntersectionObserver`, no "has it played yet" state, no trigger
logic to write.

Layout is by hand, not a graph library: 2–4 cards placed on a circle, arrows
drawn as quadratic béziers bowed away from the ring's centre so a direct
swap's two opposite arrows separate into a lens shape instead of overlapping.

**This component had a real bug that no amount of re-reading the code would
have caught**, because it's only visible in a render. A CSS `transform` —
which the entrance keyframe sets — takes precedence over an SVG
`transform="translate(x, y)"` *presentation attribute* on the same element.
Animating the positioned node group directly meant the keyframe's
`scale(1) translateY(0)` end state silently overwrote each card's position:
every card collapsed onto the origin, and only the last one painted was
visible, in the wrong spot. Caught by rendering `CycleView` with fabricated
data on a throwaway route, screenshotting it with Playwright, and looking —
the SQL and TypeScript test suites have no opinion on where an SVG rect lands.
Fixed by splitting each node into an outer group that only positions (an SVG
attribute, untouched by CSS) and an inner group that only animates
(`transform-box: fill-box`, so it scales from its own centre rather than the
whole SVG's). The throwaway route was deleted afterward; the fix and a comment
explaining why the split matters were not.

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
app/
  actions/                                     server actions: the only way the client writes
    auth.ts  listings.ts  wants.ts  matches.ts  messages.ts
  sign-in/  browse/  shelf/  wants/  matches/   the nine routes
  auth/callback/route.ts                        magic-link landing
  layout.tsx  globals.css                       fonts, design tokens, header
  proxy.ts (repo root)                          session-cookie refresh (Next 16's proxy convention)
components/
  CycleView.tsx                                 the cycle diagram — see "The cycle view" above
  BrowseIndex.tsx  MatchIndex.tsx                list-detail shells for their routes
  NewCopyForm.tsx  NewWantForm.tsx               the two-step resolve-then-review flow
  SignInForm.tsx  SendMessageForm.tsx  *Actions.tsx   small client components, one concern each
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
  data/                                        server-only reads: browse, shelf, wants, matches, cash, messages, session
  supabase/
    server.ts  client.ts                       the two Supabase clients (request-scoped / browser)
    session-refresh.ts                         used by proxy.ts
    types.ts                                   hand-written Database type — see the note at its top
    env.ts                                     reads NEXT_PUBLIC_* once, in one place
  tags/vocabulary.ts                           the controlled tag list
  format.ts                                    money, dates, condition labels
supabase/
  migrations/
    20260814000100_config_and_types.sql        app_config, enums, slugify, condition_score
    20260814000200_core_tables.sql             the eight tables
    20260814000300_campus_domain_and_signup.sql  domain trigger, profile provisioning
    20260814000400_rls.sql                     policies + column-level guards
    20260814000500_matching.sql                edges, cycle search, pricing, materialization
    20260814000600_storage_and_realtime.sql    photo bucket, publication
    20260814000700_catalogue_resolution.sql    resolve_book, title_key, tag vocabulary
    20260814000800_auto_refresh_matches.sql    the trigger step 5's realtime will subscribe to
    20260814000900_copy_description.sql        where enrich()'s description is stored
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
