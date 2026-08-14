'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

const LINKS = [
  { href: '/browse', label: 'Browse' },
  { href: '/shelf', label: 'My Shelf' },
  { href: '/wants', label: 'My Wants' },
  { href: '/matches', label: 'Matches' },
] as const;

export function Nav() {
  const pathname = usePathname();

  return (
    <nav className="site-nav" aria-label="Main">
      {LINKS.map((link) => {
        const active = pathname === link.href || pathname?.startsWith(`${link.href}/`);
        return (
          <Link key={link.href} href={link.href} className="site-nav__link" aria-current={active ? 'page' : undefined}>
            {link.label}
          </Link>
        );
      })}
    </nav>
  );
}
