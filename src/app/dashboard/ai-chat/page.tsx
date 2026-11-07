'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { LoadingPage } from '@/components/ui/loading';

// The AI chat moved to the main screen (canvas Main.dc.html). Client-side replace: a server redirect()
// under the client AuthProvider layout breaks the dev router ("Rendered more hooks").
export default function AIChatRedirect() {
  const router = useRouter();
  useEffect(() => {
    router.replace('/dashboard');
  }, [router]);
  return <LoadingPage label="Membuka chat..." />;
}
