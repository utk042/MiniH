import { redirect } from 'next/navigation';
import { SignInForm } from '../../components/SignInForm';
import { currentProfile } from '../../lib/data/session';
import { isSupabaseConfigured } from '../../lib/supabase/env';

export default async function SignInPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string; error?: string }>;
}) {
  const { next, error } = await searchParams;
  const profile = await currentProfile();
  if (profile) redirect(next || '/browse');

  return (
    <div className="stack" style={{ maxWidth: '32rem' }}>
      <div>
        <p className="eyebrow">Sign in</p>
        <h1 className="page-title" style={{ marginTop: '0.25rem' }}>
          Nobody gets in without a campus address
        </h1>
      </div>

      {!isSupabaseConfigured() ? (
        <div className="notice notice--error">
          <p className="notice__heading">No database on file</p>
          <p className="notice__body">
            This installation has no Supabase project configured, so there is nothing to sign in to. Copy{' '}
            <code className="mono">.env.example</code> to <code className="mono">.env.local</code>, fill in the
            Supabase values, and restart.
          </p>
        </div>
      ) : (
        <>
          {error === 'link-expired' && (
            <div className="notice notice--error">
              <p className="notice__heading">That link didn't work</p>
              <p className="notice__body">
                It may have expired or already been used. Sign-in links are good for one visit, within an hour of
                being sent. Ask for a new one below.
              </p>
            </div>
          )}
          <SignInForm next={next || '/browse'} />
        </>
      )}
    </div>
  );
}
