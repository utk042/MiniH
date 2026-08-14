import type { Metadata } from 'next';
import { BrowseIndex } from '../../components/BrowseIndex';
import { requireProfile } from '../../lib/data/session';

export const metadata: Metadata = { title: 'Browse — BACKSTACK' };

export default async function BrowsePage() {
  const profile = await requireProfile('/browse');
  return <BrowseIndex currentUserId={profile.id} />;
}
