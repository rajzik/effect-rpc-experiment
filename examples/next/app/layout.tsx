import type { Metadata } from 'next';
import type { ReactNode } from 'react';

import { RpcProvider } from '@/trpc/client';

export const metadata: Metadata = { title: 'Task board (Next.js)' };

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>
        <RpcProvider>{children}</RpcProvider>
      </body>
    </html>
  );
}
