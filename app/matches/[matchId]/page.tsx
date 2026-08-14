import type { Metadata } from 'next';
import { MatchIndex } from '../../../components/MatchIndex';
import { requireProfile } from '../../../lib/data/session';

export const metadata: Metadata = { title: 'Matches — BACKSTACK' };

export default async function MatchDetailPage({ params }: { params: Promise<{ matchId: string }> }) {
  const { matchId } = await params;
  const profile = await requireProfile(`/matches/${matchId}`);
  return (
    <div className="stack">
      <div>
        <p className="eyebrow">Matches</p>
        <h1 className="page-title" style={{ marginTop: '0.25rem' }}>
          Trades the graph found
        </h1>
      </div>
      <MatchIndex userId={profile.id} selectedMatchId={matchId} />
    </div>
  );
}
