'use client';

import { useEffect, useRef } from 'react';
import { transport } from '../../lib/api';

export default function LogoutPage() {
  const started = useRef(false);

  useEffect(() => {
    if (started.current) {
      return;
    }
    started.current = true;

    // Opting out of the 401 policy: a signed-out visitor landing here still
    // goes to /login, and there is nothing to expire.
    void transport('/api/auth/logout', { method: 'POST' }).finally(() => {
      window.location.assign('/login');
    });
  }, []);

  return (
    <section>
      <h1>Sign out</h1>
      <p>Signing out…</p>
    </section>
  );
}
