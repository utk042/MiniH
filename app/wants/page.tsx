import type { Metadata } from 'next';
import { NewWantForm } from '../../components/NewWantForm';
import { Notice } from '../../components/Notice';
import { WantRowActions } from '../../components/WantRowActions';
import { requireProfile } from '../../lib/data/session';
import { listMyWants } from '../../lib/data/wants';

export const metadata: Metadata = { title: 'My Wants — BACKSTACK' };

const PRIORITY_LABEL: Record<number, string> = {
  1: 'urgent',
  2: 'soon',
  3: 'no rush',
  4: 'low',
  5: 'idle curiosity',
};

const STATUS_LABEL: Record<string, string> = {
  active: 'Active',
  fulfilled: 'Fulfilled',
  archived: 'Archived',
};

export default async function WantsPage() {
  const profile = await requireProfile('/wants');
  const wants = await listMyWants(profile.id);

  return (
    <div className="stack">
      <div>
        <p className="eyebrow">My Wants</p>
        <h1 className="page-title" style={{ marginTop: '0.25rem' }}>
          What you need
        </h1>
        <p className="muted" style={{ marginTop: '0.25rem', fontSize: '0.875rem' }}>
          Private to you. Other students never see this list — only the trades it produces, on{' '}
          <a href="/matches" style={{ textDecoration: 'underline' }}>
            Matches
          </a>
          .
        </p>
      </div>

      <NewWantForm />

      {wants.length === 0 ? (
        <Notice heading="No wants on file">
          Add what you need for next term above. The moment someone's shelf can supply it — directly, or through a
          longer cycle — it will surface as a match.
        </Notice>
      ) : (
        <ul className="stack" style={{ gap: 0 }}>
          {wants.map((want) => (
            <li key={want.wantId} className="card row-between" style={{ marginTop: 0 }}>
              <div>
                <p className="book-title" style={{ fontSize: '1rem' }}>
                  {want.title}
                  {want.editionLabel && <span className="muted"> · {want.editionLabel}</span>}
                </p>
                <div className="index-row__meta" style={{ marginTop: '0.4rem' }}>
                  <span className="tag mono">{PRIORITY_LABEL[want.priority] ?? want.priority}</span>
                  <span className="tag mono">{STATUS_LABEL[want.status] ?? want.status}</span>
                  {want.editionStrict && <span className="tag mono">exact edition only</span>}
                </div>
                {want.note && (
                  <p className="muted" style={{ fontSize: '0.8125rem', marginTop: '0.4rem' }}>
                    {want.note}
                  </p>
                )}
              </div>
              <WantRowActions wantId={want.wantId} status={want.status} />
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
