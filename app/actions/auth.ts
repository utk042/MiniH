'use server';

import { campusEmailDomain } from '../../lib/supabase/env';
import { supabaseServer } from '../../lib/supabase/server';

/**
 * The database trigger is what actually enforces the campus domain — this is
 * only a faster, kinder failure than "we sent you a link, it will fail when
 * you click it." A gmail address never gets an email in the first place.
 */
export async function requestMagicLink(
  email: string,
  redirectPath: string,
): Promise<{ error: string } | { sent: true }> {
  const trimmed = email.trim().toLowerCase();
  const domain = campusEmailDomain();

  if (!trimmed.includes('@')) {
    return { error: 'That does not look like an email address.' };
  }
  if (!trimmed.endsWith(`@${domain}`)) {
    return { error: `BACKSTACK is restricted to @${domain} addresses.` };
  }

  const supabase = await supabaseServer();
  const siteUrl = process.env.NEXT_PUBLIC_SITE_URL ?? 'http://localhost:3000';
  const { error } = await supabase.auth.signInWithOtp({
    email: trimmed,
    options: {
      emailRedirectTo: `${siteUrl}/auth/callback?next=${encodeURIComponent(redirectPath)}`,
    },
  });

  if (error) return { error: error.message };
  return { sent: true };
}

export async function signOut(): Promise<void> {
  const supabase = await supabaseServer();
  await supabase.auth.signOut();
}
