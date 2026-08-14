'use client';

import { useState, useTransition } from 'react';
import { archiveWant, reactivateWant } from '../app/actions/wants';
import type { WantStatus } from '../lib/supabase/types';

export function WantRowActions({ wantId, status }: { wantId: string; status: WantStatus }) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function run(action: (id: string) => Promise<{ error: string } | { ok: true }>) {
    startTransition(async () => {
      const result = await action(wantId);
      setError('error' in result ? result.error : null);
    });
  }

  if (status === 'fulfilled') {
    return <span className="muted mono" style={{ fontSize: '0.75rem' }}>fulfilled</span>;
  }

  return (
    <div>
      {status === 'active' ? (
        <button type="button" className="btn btn--danger btn--small" disabled={pending} onClick={() => run(archiveWant)}>
          {pending ? 'Archiving…' : 'Archive'}
        </button>
      ) : (
        <button type="button" className="btn btn--ghost btn--small" disabled={pending} onClick={() => run(reactivateWant)}>
          {pending ? 'Reactivating…' : 'Reactivate'}
        </button>
      )}
      {error && (
        <p className="field__error" role="alert" style={{ marginTop: '0.25rem' }}>
          {error}
        </p>
      )}
    </div>
  );
}
