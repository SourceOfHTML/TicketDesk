import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import { Header } from '../components/header';
import { SessionProvider } from '../components/session-provider';

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
          <main>{children}</main>
        </SessionProvider>
      </body>
    </html>
  );
}
