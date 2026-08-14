'use client';

import { useId, useRef, useState, type FormEvent } from 'react';
import { sendMessage } from '../app/actions/messages';

export function SendMessageForm({ matchId }: { matchId: string }) {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const formRef = useRef<HTMLFormElement>(null);
  const inputId = useId();

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const body = new FormData(event.currentTarget).get('body');
    if (typeof body !== 'string' || !body.trim()) return;

    setPending(true);
    setError(null);

    const result = await sendMessage(matchId, body);

    if ('error' in result) {
      setError(result.error);
    } else {
      formRef.current?.reset();
    }
    setPending(false);
  }

  return (
    <form ref={formRef} onSubmit={onSubmit} className="row-between" style={{ alignItems: 'flex-start', gap: 'var(--space-2)' }}>
      <label htmlFor={inputId} className="sr-only">
        Message
      </label>
      <textarea
        id={inputId}
        name="body"
        placeholder="Where and when?"
        style={{ minHeight: '2.75rem', flex: 1 }}
        maxLength={2000}
        required
      />
      <button type="submit" className="btn btn--small" disabled={pending}>
        {pending ? 'Sending…' : 'Send'}
      </button>
      {error && (
        <p className="field__error" role="alert">
          {error}
        </p>
      )}
    </form>
  );
}
