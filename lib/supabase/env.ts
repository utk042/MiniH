/**
 * Reads Supabase configuration from the environment. A function, not a
 * module-level constant, so a missing variable fails the request that needed
 * it rather than the build that didn't.
 */
export interface SupabaseEnv {
  url: string;
  anonKey: string;
}

export function supabaseEnv(): SupabaseEnv {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (!url || !anonKey) {
    throw new MissingSupabaseConfigError();
  }

  return { url, anonKey };
}

export class MissingSupabaseConfigError extends Error {
  constructor() {
    super(
      'NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY are not set. Copy .env.example to .env.local and fill them in.',
    );
    this.name = 'MissingSupabaseConfigError';
  }
}

export function campusEmailDomain(): string {
  return process.env.NEXT_PUBLIC_CAMPUS_EMAIL_DOMAIN || 'westfield.edu';
}

export function campusName(): string {
  return process.env.NEXT_PUBLIC_CAMPUS_NAME || 'the campus';
}

export function copyPhotoBucket(): string {
  return process.env.NEXT_PUBLIC_SUPABASE_COPY_PHOTO_BUCKET || 'copy-photos';
}

/** A non-throwing check, for chrome that needs to know without needing the values. */
export function isSupabaseConfigured(): boolean {
  return Boolean(process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY);
}
