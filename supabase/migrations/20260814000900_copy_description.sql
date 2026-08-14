-- ---------------------------------------------------------------------------
-- 000900 — a place to put the description enrich() writes
--
-- enrich() (lib/canonicalize/enrich.ts) has produced two sentences of plain,
-- factual copy since step 2, but nothing was ever asked to store it: it
-- depends on a specific copy's condition and notes, not just the canonical
-- book, so it belongs on copies, not books.
-- ---------------------------------------------------------------------------

alter table public.copies
  add column description text check (description is null or char_length(description) <= 400);

comment on column public.copies.description is
  'Two sentences, plain and factual, written by enrich() from this copy''s condition and notes. A student may overwrite it before listing; there is no further validation once stored.';
