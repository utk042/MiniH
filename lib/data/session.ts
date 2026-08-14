import { redirect } from 'next/navigation';
import { isSupabaseConfigured } from '../supabase/env';
import { supabaseServer } from '../supabase/server';

export interface Profile {
  id: string;
  email: string;
  handle: string;
  displayName: string;
  pickupSpot: string | null;
  bio: string | null;
}

/** Null when signed out, or when Supabase isn't configured yet. Never throws. */
export async function currentProfile(): Promise<Profile | null> {
  if (!isSupabaseConfigured()) return null;
  const supabase = await supabaseServer();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;

  const { data, error } = await supabase
    .from('profiles')
    .select('id, email, handle, display_name, pickup_spot, bio')
    .eq('id', user.id)
    .maybeSingle();

  if (error || !data) return null;

  return {
    id: data.id,
    email: data.email,
    handle: data.handle,
    displayName: data.display_name,
    pickupSpot: data.pickup_spot,
    bio: data.bio,
  };
}

/** For pages that only make sense signed in. Sends the student to sign in and back. */
export async function requireProfile(returnTo: string): Promise<Profile> {
  const profile = await currentProfile();
  if (!profile) {
    redirect(`/sign-in?next=${encodeURIComponent(returnTo)}`);
  }
  return profile;
}
