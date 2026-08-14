'use client';

import { useId, useState, type FormEvent } from 'react';
import { createCopyListing, resolveListingDraft, type ResolvedListingDraft } from '../app/actions/listings';
import { CONDITION_LABEL, CONDITION_ORDER } from '../lib/format';
import type { CopyCondition } from '../lib/supabase/types';
import { TagList } from './TagList';

const SOURCE_LABEL: Record<ResolvedListingDraft['source'], string> = {
  cache: 'seen before, resolved instantly',
  gemini: 'resolved by AI',
  fallback: 'resolved without the model',
  human: 'resolved from a saved correction',
};

export function NewCopyForm({ onListed }: { onListed?: () => void }) {
  const [rawInput, setRawInput] = useState('');
  const [phase, setPhase] = useState<'draft' | 'resolving' | 'review' | 'submitting'>('draft');
  const [draft, setDraft] = useState<ResolvedListingDraft | null>(null);
  const [error, setError] = useState<string | null>(null);

  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [condition, setCondition] = useState<CopyCondition>('good');
  const [askPrice, setAskPrice] = useState('');
  const [notes, setNotes] = useState('');

  const rawId = useId();
  const titleId = useId();
  const descriptionId = useId();
  const conditionId = useId();
  const priceId = useId();
  const notesId = useId();

  async function onResolve(event: FormEvent) {
    event.preventDefault();
    if (!rawInput.trim()) return;

    setPhase('resolving');
    setError(null);

    const result = await resolveListingDraft(rawInput);
    if ('error' in result) {
      setError(result.error);
      setPhase('draft');
      return;
    }

    setDraft(result.draft);
    setTitle(result.draft.title);
    setDescription(result.draft.description);
    setCondition(result.draft.conditionGuess ?? 'good');
    setPhase('review');
  }

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    if (!draft) return;

    setPhase('submitting');
    setError(null);

    const result = await createCopyListing({
      draft,
      correctedTitle: title !== draft.title ? title : undefined,
      correctedDescription: description !== draft.description ? description : undefined,
      condition,
      askPriceCents: askPrice ? Math.round(Number.parseFloat(askPrice) * 100) : null,
      notes: notes.trim() || null,
    });

    if ('error' in result) {
      setError(result.error);
      setPhase('review');
      return;
    }

    setRawInput('');
    setDraft(null);
    setTitle('');
    setDescription('');
    setCondition('good');
    setAskPrice('');
    setNotes('');
    setPhase('draft');
    onListed?.();
  }

  function onStartOver() {
    setDraft(null);
    setPhase('draft');
    setError(null);
  }

  if (phase === 'draft' || phase === 'resolving') {
    return (
      <form onSubmit={onResolve} className="card">
        <div className="field">
          <label className="field__label" htmlFor={rawId}>
            What are you listing?
          </label>
          <textarea
            id={rawId}
            value={rawInput}
            onChange={(event) => setRawInput(event.target.value)}
            placeholder="orgo 3rd ed morrison boyd, spine cracked"
            aria-describedby={`${rawId}-hint`}
            required
          />
          <p className="field__hint" id={`${rawId}-hint`}>
            Title, author, edition, condition — however you'd say it out loud. Shorthand and typos are fine.
          </p>
        </div>
        {error && (
          <p className="field__error" role="alert">
            {error}
          </p>
        )}
        <button type="submit" className="btn" disabled={phase === 'resolving' || !rawInput.trim()}>
          {phase === 'resolving' ? 'Reading…' : 'Resolve'}
        </button>
      </form>
    );
  }

  if (!draft) return null;

  return (
    <form onSubmit={onSubmit} className="card">
      <div className="row-between" style={{ marginBottom: 'var(--space-4)' }}>
        <span className="ai-badge">
          {SOURCE_LABEL[draft.source]}
          {draft.matchedExistingBook && ' · matched an existing catalogue entry'}
        </span>
        <button type="button" className="text-link" onClick={onStartOver} style={{ fontSize: '0.8125rem' }}>
          Start over
        </button>
      </div>

      {draft.warnings.length > 0 && (
        <ul className="field__hint" style={{ marginBottom: 'var(--space-4)' }}>
          {draft.warnings.map((warning) => (
            <li key={warning}>{warning}</li>
          ))}
        </ul>
      )}

      <div className="field">
        <label className="field__label" htmlFor={titleId}>
          Title
        </label>
        <input id={titleId} value={title} onChange={(event) => setTitle(event.target.value)} required />
        <p className="field__hint">
          {draft.authors.join(', ') || 'No author identified'}
          {draft.edition ? ` · ${draft.edition}` : ''} · key: <span className="mono">{draft.canonicalKey}</span>
        </p>
      </div>

      <div className="field">
        <span className="field__label">Tags</span>
        <TagList tags={draft.tags} />
      </div>

      <div className="field">
        <label className="field__label" htmlFor={descriptionId}>
          Description
        </label>
        <textarea id={descriptionId} value={description} onChange={(event) => setDescription(event.target.value)} />
      </div>

      <div className="field">
        <label className="field__label" htmlFor={conditionId}>
          Condition
        </label>
        <select
          id={conditionId}
          value={condition}
          onChange={(event) => setCondition(event.target.value as CopyCondition)}
        >
          {CONDITION_ORDER.map((value) => (
            <option key={value} value={value}>
              {CONDITION_LABEL[value]}
            </option>
          ))}
        </select>
      </div>

      <div className="field">
        <label className="field__label" htmlFor={priceId}>
          Asking price (optional)
        </label>
        <input
          id={priceId}
          type="number"
          inputMode="decimal"
          min="0"
          step="0.01"
          placeholder="0.00"
          value={askPrice}
          onChange={(event) => setAskPrice(event.target.value)}
        />
        <p className="field__hint">Only used if nobody wants a swap. Leave blank if you only want to trade.</p>
      </div>

      <div className="field">
        <label className="field__label" htmlFor={notesId}>
          Notes for the seller's line (optional)
        </label>
        <textarea
          id={notesId}
          value={notes}
          onChange={(event) => setNotes(event.target.value)}
          placeholder="Anything the description above should have mentioned."
        />
      </div>

      {error && (
        <p className="field__error" role="alert">
          {error}
        </p>
      )}

      <button type="submit" className="btn" disabled={phase === 'submitting'}>
        {phase === 'submitting' ? 'Listing…' : 'Add to shelf'}
      </button>
    </form>
  );
}
