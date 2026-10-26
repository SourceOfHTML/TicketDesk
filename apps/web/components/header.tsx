'use client';

import Link from 'next/link';
import { useSession } from './session-provider';

export function Header() {
  const { user } = useSession();

  return (
    <header className="site-header">
      <Link className="site-brand" href="/tickets">
        TicketDesk
      </Link>
      {user === null ? null : (
        <nav className="site-nav" aria-label="Session">
          <span className="site-nav-email">{user.email}</span>
          {/* A hard navigation: sign-out must not leave a stale session context. */}
          <a href="/logout">Sign out</a>
        </nav>
      )}
    </header>
  );
}
