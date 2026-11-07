'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useAuthStore } from '@/stores/auth-store';
import { LoadingPage } from '@/components/ui/loading';

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const { user, loading, fetchUser } = useAuthStore();
  const router = useRouter();

  useEffect(() => {
    fetchUser();
  }, [fetchUser]);

  useEffect(() => {
    if (!loading && !user) {
      router.push('/login');
    }
  }, [loading, user, router]);

  if (loading || !user) {
    return <LoadingPage label="Memuat sesi..." />;
  }

  return <>{children}</>;
}
