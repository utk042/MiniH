import Link from 'next/link';
import { signOut } from '../app/actions/auth';
import { campusName } from '../lib/supabase/env';
import type { Profile } from '../lib/data/session';
import { Nav } from './Nav';

export function Header({ profile }: { profile: Profile | null }) {
  return (
    <header className="site-header">
      <div className="shell site-header__bar">
        <Link href="/" className="wordmark">
          <span className="wordmark__name">BACKSTACK</span>
          <span className="wordmark__campus">{campusName()}</span>
        </Link>

        {profile && <Nav />}

        <div className="account-line">
          {profile ? (
            <>
              <span className="account-line__handle">@{profile.handle}</span>
              <form action={signOut}>
                <button type="submit" className="text-link">
                  Sign out
                </button>
              </form>
            </>
          ) : (
            <Link href="/sign-in" className="text-link">
              Sign in
            </Link>
          )}
        </div>
      </div>
    </header>
  );
}
