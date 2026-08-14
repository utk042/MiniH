import { supabaseServer } from '../supabase/server';
import type { MatchKind, MatchStatus } from '../supabase/types';

export interface MatchLeg {
  position: number;
  giverId: string;
  giverHandle: string;
  giverDisplayName: string;
  receiverId: string;
  receiverHandle: string;
  receiverDisplayName: string;
  bookTitle: string;
  bookEditionLabel: string | null;
  exact: boolean;
}

export interface MatchSummary {
  matchId: string;
  kind: MatchKind;
  legCount: number;
  status: MatchStatus;
  allExact: boolean;
  totalCondition: number;
  refreshedAt: string;
  legs: MatchLeg[];
  /** The leg where the caller gives something, so the UI can say "you give". */
  myLegPosition: number | null;
}

interface RawMatchRow {
  id: string;
  kind: MatchKind;
  leg_count: number;
  status: MatchStatus;
  all_exact: boolean;
  total_condition: number;
  refreshed_at: string;
}

interface RawLegRow {
  match_id: string;
  position: number;
  giver_id: string;
  receiver_id: string;
  exact: boolean;
  giver: { handle: string; display_name: string } | null;
  receiver: { handle: string; display_name: string } | null;
  books: { title: string; edition_label: string | null } | null;
}

/**
 * Every trade the caller is part of, legs attached and ordered. RLS already
 * restricts `matches` and `match_legs` to participants, so this asks for
 * everything and trusts the database to have filtered it.
 */
export async function listMyMatches(userId: string): Promise<MatchSummary[]> {
  const supabase = await supabaseServer();

  const { data: matches, error: matchError } = await supabase
    .from('matches')
    .select('id, kind, leg_count, status, all_exact, total_condition, refreshed_at')
    .order('leg_count', { ascending: true })
    .order('total_condition', { ascending: false })
    .returns<RawMatchRow[]>();

  if (matchError || !matches || matches.length === 0) return [];

  const { data: legs, error: legError } = await supabase
    .from('match_legs')
    .select(
      'match_id, position, giver_id, receiver_id, exact, giver:profiles!match_legs_giver_id_fkey(handle, display_name), receiver:profiles!match_legs_receiver_id_fkey(handle, display_name), books(title, edition_label)',
    )
    .in(
      'match_id',
      matches.map((m) => m.id),
    )
    .order('position', { ascending: true })
    .returns<RawLegRow[]>();

  if (legError || !legs) return [];

  const legsByMatch = new Map<string, RawLegRow[]>();
  for (const leg of legs) {
    const list = legsByMatch.get(leg.match_id) ?? [];
    list.push(leg);
    legsByMatch.set(leg.match_id, list);
  }

  return matches
    .map((match): MatchSummary | null => {
      const rows = legsByMatch.get(match.id);
      if (!rows || rows.length === 0) return null;

      const mappedLegs: MatchLeg[] = rows.map((leg) => ({
        position: leg.position,
        giverId: leg.giver_id,
        giverHandle: leg.giver?.handle ?? 'unknown',
        giverDisplayName: leg.giver?.display_name ?? 'Unknown',
        receiverId: leg.receiver_id,
        receiverHandle: leg.receiver?.handle ?? 'unknown',
        receiverDisplayName: leg.receiver?.display_name ?? 'Unknown',
        bookTitle: leg.books?.title ?? 'Untitled',
        bookEditionLabel: leg.books?.edition_label ?? null,
        exact: leg.exact,
      }));

      const myLeg = mappedLegs.find((leg) => leg.giverId === userId);

      return {
        matchId: match.id,
        kind: match.kind,
        legCount: match.leg_count,
        status: match.status,
        allExact: match.all_exact,
        totalCondition: match.total_condition,
        refreshedAt: match.refreshed_at,
        legs: mappedLegs,
        myLegPosition: myLeg?.position ?? null,
      };
    })
    .filter((m): m is MatchSummary => m !== null);
}

export async function getMatch(matchId: string, userId: string): Promise<MatchSummary | null> {
  const matches = await listMyMatches(userId);
  return matches.find((m) => m.matchId === matchId) ?? null;
}
