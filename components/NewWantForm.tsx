'use client';

import { useId, useState, type FormEvent } from 'react';
import { createWant, resolveWantDraft, type ResolvedWantDraft } from '../app/actions/wants';

const SOURCE_LABEL: Record<ResolvedWantDraft['source'], string> = {
  cache: 'seen before, resolved instantly',
  gemini: 'resolved by AI',
  fallback: 'resolved without the model',
  human: 'resolved from a saved correction',
};

export function NewWantForm() {
  const [rawInput, setRawInput] = useState('');
  const [phase, setPhase] = useState<'draft' | 'resolving' | 'review' | 'submitting'>('draft');
  const [draft, setDraft] = useState<ResolvedWantDraft | null>(null);
  const [error, setError] = useState<string | null>(null);

  const [title, setTitle] = useState('');
  const [priority, setPriority] = useState(3);
  const [editionStrict, setEditionStrict] = useState(false);
  const [note, setNote] = useState('');

  const rawId = useId();
  const titleId = useId();
  const priorityId = useId();
  const noteId = useId();
  const strictId = useId();

  async function onResolve(event: FormEvent) {
    event.preventDefault();
    if (!rawInput.trim()) return;

    setPhase('resolving');
    setError(null);

    const result = await resolveWantDraft(rawInput);
    if ('error' in result) {
      setError(result.error);
      setPhase('draft');
      return;
    }

    setDraft(result.draft);
    setTitle(result.draft.title);
    setPhase('review');
  }

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    if (!draft) return;

    setPhase('submitting');
    setError(null);

    const result = await createWant({
      draft,
      correctedTitle: title !== draft.title ? title : undefined,
      priority,
      editionStrict,
      note: note.trim() || null,
    });

    if ('error' in result) {
      setError(result.error);
      setPhase('review');
      return;
    }

    setRawInput('');
    setDraft(null);
    setTitle('');
    setPriority(3);
    setEditionStrict(false);
    setNote('');
    setPhase('draft');
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
            What do you need?
          </label>
          <textarea
            id={rawId}
            value={rawInput}
            onChange={(event) => setRawInput(event.target.value)}
            placeholder="campbell bio 12e"
            aria-describedby={`${rawId}-hint`}
            required
          />
          <p className="field__hint" id={`${rawId}-hint`}>
            This stays private — nobody sees your wants, only the trades they produce.
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
        <label className="field__label" htmlFor={priorityId}>
          How urgent
        </label>
        <select id={priorityId} value={priority} onChange={(event) => setPriority(Number(event.target.value))}>
          <option value={1}>1 — need it before the term starts</option>
          <option value={2}>2</option>
          <option value={3}>3 — no particular rush</option>
          <option value={4}>4</option>
          <option value={5}>5 — idle curiosity</option>
        </select>
      </div>

      <div className="checkbox-field" style={{ marginBottom: 'var(--space-4)' }}>
        <input
          id={strictId}
          type="checkbox"
          checked={editionStrict}
          onChange={(event) => setEditionStrict(event.target.checked)}
        />
        <label htmlFor={strictId}>
          Must be this exact edition — a different edition of the same book will not count as a match
        </label>
      </div>

      <div className="field">
        <label className="field__label" htmlFor={noteId}>
          Note to yourself (optional)
        </label>
        <textarea
          id={noteId}
          value={note}
          onChange={(event) => setNote(event.target.value)}
          placeholder="e.g. which course this is for"
        />
      </div>

      {error && (
        <p className="field__error" role="alert">
          {error}
        </p>
      )}

      <button type="submit" className="btn" disabled={phase === 'submitting'}>
        {phase === 'submitting' ? 'Adding…' : 'Add to wants'}
      </button>
    </form>
  );
}
