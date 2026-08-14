import Link from 'next/link';
import { getCopyDetail, listOpenCopies, type BrowseRow } from '../lib/data/browse';
import { formatAuthors } from '../lib/format';
import { ConditionBadge } from './ConditionBadge';
import { ListDetailShell } from './ListDetailShell';
import { Notice } from './Notice';
import { Price } from './Price';
import { TagList } from './TagList';

function IndexRow({ row, selected }: { row: BrowseRow; selected: boolean }) {
  return (
    <li>
      <Link href={`/browse/${row.copyId}`} className="index-row" aria-current={selected ? 'true' : undefined}>
        <p className="index-row__title book-title">
          {row.title}
          {row.editionLabel && <span className="muted"> · {row.editionLabel}</span>}
        </p>
        <p className="index-row__byline">
          {formatAuthors(row.authors)}
          {row.isMine && <span className="mono"> · yours</span>}
        </p>
        <div className="index-row__meta">
          <ConditionBadge condition={row.condition} />
          <Price cents={row.askPriceCents} />
          {row.courseCodes.slice(0, 2).map((code) => (
            <span key={code} className="tag mono">
              {code}
            </span>
          ))}
        </div>
      </Link>
    </li>
  );
}

export async function BrowseIndex({
  currentUserId,
  selectedCopyId,
}: {
  currentUserId: string | null;
  selectedCopyId?: string;
}) {
  const rows = await listOpenCopies(currentUserId);

  const list =
    rows.length === 0 ? (
      <div style={{ padding: 'var(--space-5)' }}>
        <Notice heading="The shelf is bare">
          Nobody on campus has listed an open copy yet. Once someone does, it will appear here, alphabetical by
          title, the way a card catalogue would hold it.
        </Notice>
      </div>
    ) : (
      <ul aria-label="Open copies, alphabetical by title">
        {rows.map((row) => (
          <IndexRow key={row.copyId} row={row} selected={row.copyId === selectedCopyId} />
        ))}
      </ul>
    );

  let detail = (
    <Notice heading="Select a card">
      Pick a title on the left to read its full entry — condition, tags, who has it, and how many people on campus
      want it.
    </Notice>
  );

  if (selectedCopyId) {
    const copy = await getCopyDetail(selectedCopyId, currentUserId);
    detail = copy ? (
      <CopyDetailPane copy={copy} />
    ) : (
      <Notice heading="That entry is gone" tone="error">
        Either it was withdrawn, or the card never existed. <Link href="/browse">Back to the index.</Link>
      </Notice>
    );
  }

  return <ListDetailShell list={list} detail={detail} hasSelection={Boolean(selectedCopyId)} />;
}

function CopyDetailPane({ copy }: { copy: Awaited<ReturnType<typeof getCopyDetail>> & object }) {
  return (
    <article>
      <Link href="/browse" className="back-link">
        ← Back to the index
      </Link>

      <p className="eyebrow">{copy.canonicalKey}</p>
      <h1 className="book-title" style={{ fontSize: '1.5rem', marginTop: '0.25rem' }}>
        {copy.title}
      </h1>
      {copy.editionLabel && <p className="muted" style={{ marginTop: '0.15rem' }}>{copy.editionLabel}</p>}
      {copy.authors.length > 0 && <p className="muted">{formatAuthors(copy.authors)}</p>}

      <div className="index-row__meta" style={{ marginTop: 'var(--space-4)' }}>
        <ConditionBadge condition={copy.condition} />
        <Price cents={copy.askPriceCents} />
        {copy.demand > 0 && (
          <span className="tag mono">
            {copy.demand} {copy.demand === 1 ? 'person wants this' : 'people want this'}
          </span>
        )}
      </div>

      {copy.description && (
        <p style={{ marginTop: 'var(--space-4)', lineHeight: 1.6 }}>{copy.description}</p>
      )}

      {copy.notes && (
        <p className="muted" style={{ marginTop: 'var(--space-3)', fontSize: '0.875rem' }}>
          Seller's note: {copy.notes}
        </p>
      )}

      <div style={{ marginTop: 'var(--space-4)' }}>
        <TagList tags={copy.subjectTags} />
      </div>

      <hr />

      {copy.isMine ? (
        <p className="muted" style={{ fontSize: '0.875rem' }}>
          This is your listing. Manage it from <Link href="/shelf">My Shelf</Link>.
        </p>
      ) : (
        <p className="muted" style={{ fontSize: '0.875rem' }}>
          Held by <span className="mono">@{copy.ownerHandle}</span> ({copy.ownerDisplayName}). To arrange a swap, add
          this book to <Link href="/wants">My Wants</Link> — if a cycle exists, it will show up on{' '}
          <Link href="/matches">Matches</Link>.
        </p>
      )}
    </article>
  );
}
