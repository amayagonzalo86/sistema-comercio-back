'use client';

import type { ReactNode } from 'react';
import { ToastProvider } from '@/components/ui/Toast';
import { SessionProvider } from '@/lib/auth/session';

export function Providers({ children }: { children: ReactNode }) {
  return (
    <SessionProvider>
      <ToastProvider>{children}</ToastProvider>
    </SessionProvider>
  );
}
