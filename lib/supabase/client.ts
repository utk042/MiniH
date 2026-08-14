'use client';

import { createBrowserClient } from '@supabase/ssr';
import { supabaseEnv } from './env';
import type { Database } from './types';

let browserClient: ReturnType<typeof createBrowserClient<Database>> | undefined;

/** One client per tab, for Client Components: the sign-in form and realtime. */
export function supabaseBrowser() {
  const { url, anonKey } = supabaseEnv();
  browserClient ??= createBrowserClient<Database>(url, anonKey);
  return browserClient;
}
