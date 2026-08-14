import { redirect } from 'next/navigation';
import { currentProfile } from '../lib/data/session';

export default async function HomePage() {
  const profile = await currentProfile();
  redirect(profile ? '/browse' : '/sign-in');
}
