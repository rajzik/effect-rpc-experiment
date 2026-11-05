// app/layout.tsx
import type { ReactNode } from 'react';

import { RpcProvider } from '../trpc/client';

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>
        <RpcProvider>{children}</RpcProvider>
      </body>
    </html>
  );
}
