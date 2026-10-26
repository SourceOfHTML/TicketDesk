import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import { Header } from '../components/header';
import { SessionProvider } from '../components/session-provider';
import './globals.css';

export const metadata: Metadata = {
  title: 'TicketDesk',
  description: 'A local helpdesk ticket tracker.',
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>
        <SessionProvider>
          <Header />
          <main className="site-main">{children}</main>
        </SessionProvider>
      </body>
    </html>
  );
}
