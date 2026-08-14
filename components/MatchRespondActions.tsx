'use client';

import { useState, useTransition } from 'react';
import { respondToMatch } from '../app/actions/matches';
import type { MatchStatus } from '../lib/supabase/types';

export function MatchRespondActions({ matchId, status }: { matchId: string; status: MatchStatus }) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function respond(next: 'accepted' | 'declined' | 'completed') {
    startTransition(async () => {
      const result = await respondToMatch(matchId, next);
      setError('error' in result ? result.error : null);
    });
  }

  if (status === 'proposed') {
    return (
      <div className="row-between" style={{ justifyContent: 'flex-start', gap: 'var(--space-3)' }}>
        <button type="button" className="btn btn--stamp" disabled={pending} onClick={() => respond('accepted')}>
          {pending ? 'Working…' : 'Accept trade'}
        </button>
        <button type="button" className="btn btn--danger" disabled={pending} onClick={() => respond('declined')}>
          Decline
        </button>
        {error && (
          <p className="field__error" role="alert">
            {error}
          </p>
        )}
      </div>
    );
  }

  if (status === 'accepted') {
    return (
      <div className="row-between" style={{ justifyContent: 'flex-start', gap: 'var(--space-3)' }}>
        <span className="stamp-badge">Accepted</span>
        <button type="button" className="btn btn--ghost btn--small" disabled={pending} onClick={() => respond('completed')}>
          {pending ? 'Working…' : 'Mark handed off'}
        </button>
        {error && (
          <p className="field__error" role="alert">
            {error}
          </p>
        )}
      </div>
    );
  }

  const label: Partial<Record<MatchStatus, string>> = {
    declined: 'Declined',
    completed: 'Completed',
    expired: 'No longer available',
  };

  return <span className="condition-badge">{label[status] ?? status}</span>;
}
