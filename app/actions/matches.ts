'use server';

import { revalidatePath } from 'next/cache';
import { supabaseServer } from '../../lib/supabase/server';
import type { MatchStatus } from '../../lib/supabase/types';

/** Accept, decline, or mark complete. The database rejects anything else and any non-participant. */
export async function respondToMatch(
  matchId: string,
  status: Extract<MatchStatus, 'accepted' | 'declined' | 'completed'>,
): Promise<{ error: string } | { status: MatchStatus }> {
  const supabase = await supabaseServer();
  const { data, error } = await supabase.rpc('respond_to_match', { p_match_id: matchId, p_status: status });
  if (error) return { error: error.message };

  revalidatePath('/matches');
  revalidatePath(`/matches/${matchId}`);
  return { status: data as MatchStatus };
}
