'use client';

import { useRouter } from 'next/navigation';
import { useEffect } from 'react';
import { homeFor } from '@/lib/auth/permissions';
import { useSession } from '@/lib/auth/session';

export default function HomePage() {
  const { status, user } = useSession();
  const router = useRouter();

  useEffect(() => {
    if (status === 'authenticated') router.replace(homeFor(user?.role));
    if (status === 'anonymous') router.replace('/login');
  }, [status, user, router]);

  return (
    <div className="d-flex align-items-center justify-content-center text-muted-2 small" style={{ minHeight: '100vh' }}>
      <span className="spinner-border spinner-border-sm me-2" aria-hidden="true" />
      Cargando…
    </div>
  );
}
