import { BrowseIndex } from '../../../components/BrowseIndex';
import { requireProfile } from '../../../lib/data/session';

export default async function BrowseDetailPage({ params }: { params: Promise<{ copyId: string }> }) {
  const { copyId } = await params;
  const profile = await requireProfile(`/browse/${copyId}`);
  return <BrowseIndex currentUserId={profile.id} selectedCopyId={copyId} />;
}
