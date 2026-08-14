'use server';

import { revalidatePath } from 'next/cache';
import { supabaseServer } from '../../lib/supabase/server';

export async function sendMessage(matchId: string, body: string): Promise<{ error: string } | { ok: true }> {
  const trimmed = body.trim();
  if (!trimmed) return { error: 'Nothing to send.' };
  if (trimmed.length > 2000) return { error: 'That is too long. Keep it under 2000 characters.' };

  const supabase = await supabaseServer();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: 'Sign in first.' };

  const { error } = await supabase.from('messages').insert({ match_id: matchId, sender_id: user.id, body: trimmed });
  if (error) return { error: error.message };

  revalidatePath(`/matches/${matchId}`);
  return { ok: true };
}
