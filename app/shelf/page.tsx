import type { Metadata } from 'next';
import { NewCopyForm } from '../../components/NewCopyForm';
import { Notice } from '../../components/Notice';
import { ConditionBadge } from '../../components/ConditionBadge';
import { Price } from '../../components/Price';
import { listMyCopies } from '../../lib/data/shelf';
import { requireProfile } from '../../lib/data/session';
import { ShelfRowActions } from '../../components/ShelfRowActions';

export const metadata: Metadata = { title: 'My Shelf — BACKSTACK' };

const STATUS_LABEL: Record<string, string> = {
  open: 'Open',
  reserved: 'Reserved',
  traded: 'Traded',
  withdrawn: 'Withdrawn',
};

export default async function ShelfPage() {
  const profile = await requireProfile('/shelf');
  const copies = await listMyCopies(profile.id);

  return (
    <div className="stack">
      <div>
        <p className="eyebrow">My Shelf</p>
        <h1 className="page-title" style={{ marginTop: '0.25rem' }}>
          What you hold
        </h1>
        <p className="muted" style={{ marginTop: '0.25rem', fontSize: '0.875rem' }}>
          List a book here and BACKSTACK checks it against everyone's wants immediately — see{' '}
          <a href="/matches" style={{ textDecoration: 'underline' }}>
            Matches
          </a>{' '}
          after adding one.
        </p>
      </div>

      <NewCopyForm />

      {copies.length === 0 ? (
        <Notice heading="Nothing on the shelf yet">
          Whatever you list above will appear here — condition, price, and whether anyone still holds it.
        </Notice>
      ) : (
        <ul className="stack" style={{ gap: 0 }}>
          {copies.map((copy) => (
            <li key={copy.copyId} className="card row-between" style={{ marginTop: 0 }}>
              <div>
                <p className="book-title" style={{ fontSize: '1rem' }}>
                  {copy.title}
                  {copy.editionLabel && <span className="muted"> · {copy.editionLabel}</span>}
                </p>
                <div className="index-row__meta" style={{ marginTop: '0.4rem' }}>
                  <ConditionBadge condition={copy.condition} />
                  <Price cents={copy.askPriceCents} />
                  <span className="tag mono">{STATUS_LABEL[copy.status] ?? copy.status}</span>
                </div>
                {copy.rawInput && (
                  <p className="muted mono" style={{ fontSize: '0.75rem', marginTop: '0.4rem' }}>
                    as typed: "{copy.rawInput}"
                  </p>
                )}
              </div>
              <ShelfRowActions copyId={copy.copyId} status={copy.status} />
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
