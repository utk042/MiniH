import { supabaseServer } from '../supabase/server';
import type { CopyCondition } from '../supabase/types';

export interface CashOffer {
  wantId: string;
  copyId: string;
  bookTitle: string;
  bookEditionLabel: string | null;
  ownerHandle: string;
  ownerDisplayName: string;
  condition: CopyCondition;
  askPriceCents: number | null;
  suggestedPriceCents: number | null;
  exact: boolean;
}

/**
 * Buy/sell fallback for wants no swap cycle can fill. find_cash_offers()
 * already excludes anything a cycle covers — a swap is always the better
 * trade, so it never competes with one here.
 */
export async function listCashOffers(userId: string): Promise<CashOffer[]> {
  const supabase = await supabaseServer();

  const { data: offers, error } = await supabase.rpc('find_cash_offers', { p_user: userId, p_limit: 25 });
  if (error || !offers || offers.length === 0) return [];

  const bookIds = [...new Set(offers.map((o) => o.book_id))];
  const copyIds = offers.map((o) => o.copy_id);

  const [{ data: books }, { data: copyOwners }] = await Promise.all([
    supabase.from('books').select('id, title, edition_label').in('id', bookIds),
    supabase
      .from('copies')
      .select('id, owner_id, profiles(handle, display_name)')
      .in('id', copyIds)
      .returns<Array<{ id: string; owner_id: string; profiles: { handle: string; display_name: string } | null }>>(),
  ]);

  const bookById = new Map((books ?? []).map((b) => [b.id, b]));
  const ownerByCopy = new Map((copyOwners ?? []).map((c) => [c.id, c.profiles]));

  return offers.map((offer) => {
    const book = bookById.get(offer.book_id);
    const owner = ownerByCopy.get(offer.copy_id);
    return {
      wantId: offer.want_id,
      copyId: offer.copy_id,
      bookTitle: book?.title ?? 'Untitled',
      bookEditionLabel: book?.edition_label ?? null,
      ownerHandle: owner?.handle ?? 'unknown',
      ownerDisplayName: owner?.display_name ?? 'Unknown',
      condition: offer.condition,
      askPriceCents: offer.ask_price_cents,
      suggestedPriceCents: offer.suggested_price_cents,
      exact: offer.exact,
    };
  });
}
