import { supabaseServer } from '../supabase/server';

export interface MessageRow {
  id: string;
  senderId: string;
  senderHandle: string;
  body: string;
  createdAt: string;
  mine: boolean;
}

/**
 * A message thread's static read. Realtime delivery of new messages is step 5
 * — this is deliberately a plain server fetch for now, and the send action
 * revalidates the page rather than streaming.
 */
export async function listMessages(matchId: string, userId: string): Promise<MessageRow[]> {
  const supabase = await supabaseServer();

  const { data, error } = await supabase
    .from('messages')
    .select('id, sender_id, body, created_at, profiles(handle)')
    .eq('match_id', matchId)
    .order('created_at', { ascending: true })
    .returns<Array<{ id: string; sender_id: string; body: string; created_at: string; profiles: { handle: string } | null }>>();

  if (error || !data) return [];

  return data.map((row) => ({
    id: row.id,
    senderId: row.sender_id,
    senderHandle: row.profiles?.handle ?? 'unknown',
    body: row.body,
    createdAt: row.created_at,
    mine: row.sender_id === userId,
  }));
}
