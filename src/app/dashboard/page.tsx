'use client';

import { Suspense } from 'react';
import { ChatScreen } from '@/components/chat-ai/chat-screen';
import { LoadingPage } from '@/components/ui/loading';

// Main screen = chat (canvas Main.dc.html). Sessions live at /dashboard?session=<id>.
export default function DashboardPage() {
  return (
    <Suspense fallback={<LoadingPage label="Memuat chat..." />}>
      <ChatScreen />
    </Suspense>
  );
}
