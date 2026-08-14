'use client';

import { useId, useState, type FormEvent } from 'react';
import { requestMagicLink } from '../app/actions/auth';
import { campusEmailDomain } from '../lib/supabase/env';

export function SignInForm({ next }: { next: string }) {
  const [email, setEmail] = useState('');
  const [phase, setPhase] = useState<'idle' | 'sending' | 'sent' | 'error'>('idle');
  const [message, setMessage] = useState<string | null>(null);
  const inputId = useId();
  const domain = campusEmailDomain();

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    setPhase('sending');
    setMessage(null);

    const result = await requestMagicLink(email, next);

    if ('error' in result) {
      setPhase('error');
      setMessage(result.error);
      return;
    }

    setPhase('sent');
  }

  if (phase === 'sent') {
    return (
      <div className="notice">
        <p className="notice__heading">Check your inbox</p>
        <p className="notice__body">
          A sign-in link was sent to <span className="mono">{email}</span>. It expires in an hour. Closing this tab
          is fine — the link opens BACKSTACK directly.
        </p>
      </div>
    );
  }

  return (
    <form onSubmit={onSubmit} className="stack" style={{ maxWidth: '26rem' }} noValidate>
      <div className="field">
        <label className="field__label" htmlFor={inputId}>
          Campus email
        </label>
        <input
          id={inputId}
          name="email"
          type="email"
          inputMode="email"
          autoComplete="email"
          placeholder={`you@${domain}`}
          value={email}
          onChange={(event) => setEmail(event.target.value)}
          aria-invalid={phase === 'error'}
          aria-describedby={phase === 'error' ? `${inputId}-error` : `${inputId}-hint`}
          required
        />
        {phase === 'error' ? (
          <p className="field__error" id={`${inputId}-error`} role="alert">
            {message}
          </p>
        ) : (
          <p className="field__hint" id={`${inputId}-hint`}>
            Only @{domain} addresses can sign in. No password — we email you a link.
          </p>
        )}
      </div>

      <button type="submit" className="btn" disabled={phase === 'sending' || !email}>
        {phase === 'sending' ? 'Sending…' : 'Send sign-in link'}
      </button>
    </form>
  );
}
