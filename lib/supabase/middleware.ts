import { createServerClient } from '@supabase/ssr';
import { NextResponse, type NextRequest } from 'next/server';
import { MissingSupabaseConfigError, supabaseEnv } from './env';
import type { Database } from './types';

/**
 * Refreshes the auth cookie on every request. Supabase sessions expire in an
 * hour; without this, a student mid-session gets silently signed out the
 * first time a Server Component tries to use a stale token.
 */
export async function updateSession(request: NextRequest): Promise<NextResponse> {
  let response = NextResponse.next({ request });

  let env;
  try {
    env = supabaseEnv();
  } catch (error) {
    if (error instanceof MissingSupabaseConfigError) return response;
    throw error;
  }

  const supabase = createServerClient<Database>(env.url, env.anonKey, {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet) {
        for (const { name, value } of cookiesToSet) {
          request.cookies.set(name, value);
        }
        response = NextResponse.next({ request });
        for (const { name, value, options } of cookiesToSet) {
          response.cookies.set(name, value, options);
        }
      },
    },
  });

  // Touches the session so createServerClient's setAll fires when the token
  // needs rotating. Do not swap this for getSession(): it trusts the cookie
  // without checking it against the auth server.
  await supabase.auth.getUser();

  return response;
}
