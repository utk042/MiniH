'use client';

import { useEffect } from 'react';
import { Notice } from '../components/Notice';

export default function ErrorBoundary({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <Notice heading="That didn't work" tone="error">
      <p>Something on the back end refused the request. Nothing was lost — try again.</p>
      {error.digest && (
        <p className="mono" style={{ marginTop: '0.5rem', fontSize: '0.75rem' }}>
          Reference: {error.digest}
        </p>
      )}
      <button type="button" className="btn btn--ghost btn--small" style={{ marginTop: 'var(--space-3)' }} onClick={reset}>
        Try again
      </button>
    </Notice>
  );
}
