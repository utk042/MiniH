import { createServerClient } from '@supabase/ssr';
import { cookies } from 'next/headers';
import { supabaseEnv } from './env';
import type { Database } from './types';

/**
 * A Supabase client scoped to the signed-in student's own session, built from
 * the request's cookies. Every query it makes goes through RLS as
 * `authenticated` — there is no service-role client anywhere in the app,
 * because the pipeline and the mutations in app/actions do not need one.
 *
 * Call fresh per request (Server Component, Server Action, Route Handler).
 * Do not cache the client across requests: it closes over one request's
 * cookie jar.
 */
export async function supabaseServer() {
  const cookieStore = await cookies();
  const { url, anonKey } = supabaseEnv();

  return createServerClient<Database>(url, anonKey, {
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll(cookiesToSet) {
        try {
          for (const { name, value, options } of cookiesToSet) {
            cookieStore.set(name, value, options);
          }
        } catch {
          // Called from a Server Component render, where cookies are
          // read-only. The middleware refreshes the session on the next
          // request, so this is safe to swallow.
        }
      },
    },
  });
}
