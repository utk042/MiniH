'use client';

import { useState, useTransition } from 'react';
import { relistCopy, withdrawCopy } from '../app/actions/listings';
import type { CopyStatus } from '../lib/supabase/types';

export function ShelfRowActions({ copyId, status }: { copyId: string; status: CopyStatus }) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function run(action: (id: string) => Promise<{ error: string } | { ok: true }>) {
    startTransition(async () => {
      const result = await action(copyId);
      setError('error' in result ? result.error : null);
    });
  }

  if (status === 'traded') {
    return <span className="muted mono" style={{ fontSize: '0.75rem' }}>traded away</span>;
  }

  return (
    <div>
      {status === 'open' ? (
        <button type="button" className="btn btn--danger btn--small" disabled={pending} onClick={() => run(withdrawCopy)}>
          {pending ? 'Withdrawing…' : 'Withdraw'}
        </button>
      ) : (
        <button type="button" className="btn btn--ghost btn--small" disabled={pending} onClick={() => run(relistCopy)}>
          {pending ? 'Relisting…' : 'Relist'}
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
