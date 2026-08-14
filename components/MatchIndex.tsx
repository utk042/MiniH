import Link from 'next/link';
import { listCashOffers, type CashOffer } from '../lib/data/cash';
import { listMyMatches, type MatchSummary } from '../lib/data/matches';
import { formatCents } from '../lib/format';
import { ConditionBadge } from './ConditionBadge';
import { CycleView } from './CycleView';
import { ListDetailShell } from './ListDetailShell';
import { MatchRespondActions } from './MatchRespondActions';
import { MessageThread } from './MessageThread';
import { Notice } from './Notice';
import { Price } from './Price';

const KIND_LABEL: Record<number, string> = {
  2: 'Direct swap',
  3: '3-way cycle',
  4: '4-way cycle',
};

function MatchRow({ match, selected, userId }: { match: MatchSummary; selected: boolean; userId: string }) {
  const myLeg = match.legs.find((leg) => leg.giverId === userId);

  return (
    <li>
      <Link href={`/matches/${match.matchId}`} className="match-row" aria-current={selected ? 'true' : undefined}>
        <div className="match-row__kind">
          <span className="stamp-badge">{KIND_LABEL[match.legCount] ?? `${match.legCount}-way`}</span>
          {!match.allExact && <span className="tag mono">edition-tolerant</span>}
        </div>
        {myLeg && (
          <p className="book-title" style={{ fontSize: '0.9375rem' }}>
            You give <em>{myLeg.bookTitle}</em>
          </p>
        )}
        <p className="index-row__byline">
          {match.legCount} people · condition score {match.totalCondition} · {match.status}
        </p>
      </Link>
    </li>
  );
}

function MatchDetailPane({ match, userId }: { match: MatchSummary; userId: string }) {
  return (
    <article>
      <Link href="/matches" className="back-link">
        ← Back to matches
      </Link>

      <div className="row-between">
        <span className="stamp-badge">{KIND_LABEL[match.legCount] ?? `${match.legCount}-way cycle`}</span>
        {!match.allExact && <span className="tag mono">includes a different-edition match</span>}
      </div>

      <CycleView legs={match.legs} currentUserId={userId} />

      <hr />

      <MatchRespondActions matchId={match.matchId} status={match.status} />

      <hr />

      <MessageThread matchId={match.matchId} userId={userId} />
    </article>
  );
}

function CashOfferRow({ offer }: { offer: CashOffer }) {
  return (
    <li className="card row-between" style={{ marginTop: 0 }}>
      <div>
        <p className="book-title" style={{ fontSize: '0.9375rem' }}>
          {offer.bookTitle}
          {offer.bookEditionLabel && <span className="muted"> · {offer.bookEditionLabel}</span>}
        </p>
        <p className="index-row__byline">
          Held by <span className="mono">@{offer.ownerHandle}</span> ({offer.ownerDisplayName})
          {!offer.exact && ' · a different edition than you asked for'}
        </p>
        <div className="index-row__meta" style={{ marginTop: '0.4rem' }}>
          <ConditionBadge condition={offer.condition} />
        </div>
      </div>
      <div style={{ textAlign: 'right' }}>
        <p className="price" style={{ fontSize: '1.0625rem' }}>
          {formatCents(offer.askPriceCents ?? offer.suggestedPriceCents)}
        </p>
        {offer.askPriceCents === null && offer.suggestedPriceCents !== null && (
          <p className="muted" style={{ fontSize: '0.6875rem' }}>
            suggested
          </p>
        )}
      </div>
    </li>
  );
}

export async function MatchIndex({ userId, selectedMatchId }: { userId: string; selectedMatchId?: string }) {
  const [matches, cashOffers] = await Promise.all([listMyMatches(userId), listCashOffers(userId)]);

  const list =
    matches.length === 0 ? (
      <div style={{ padding: 'var(--space-5)' }}>
        <Notice heading="Nothing to trade yet">
          Once your shelf and your wants overlap with someone else's — directly, or three or four hops around — the
          trade will appear here.
        </Notice>
      </div>
    ) : (
      <ul aria-label="Your trades">
        {matches.map((match) => (
          <MatchRow key={match.matchId} match={match} selected={match.matchId === selectedMatchId} userId={userId} />
        ))}
      </ul>
    );

  let detail = (
    <Notice heading="Select a trade">
      Pick one on the left to see the loop — who gives what to whom — and open the thread to arrange it.
    </Notice>
  );

  if (selectedMatchId) {
    const match = matches.find((m) => m.matchId === selectedMatchId);
    detail = match ? (
      <MatchDetailPane match={match} userId={userId} />
    ) : (
      <Notice heading="That trade is gone" tone="error">
        It may have expired — a copy or a want it depended on changed. <Link href="/matches">Back to matches.</Link>
      </Notice>
    );
  }

  return (
    <div className="stack">
      <ListDetailShell list={list} detail={detail} hasSelection={Boolean(selectedMatchId)} />

      {cashOffers.length > 0 && (
        <div>
          <p className="eyebrow" style={{ marginBottom: 'var(--space-2)' }}>
            No cycle for these — buy instead
          </p>
          <ul className="stack" style={{ gap: 0 }}>
            {cashOffers.map((offer) => (
              <CashOfferRow key={offer.wantId} offer={offer} />
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
