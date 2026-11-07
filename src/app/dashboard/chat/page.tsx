'use client';

import { ChannelList } from '@/components/chat/channel-list';
import { Hash } from 'lucide-react';
import { ScreenHeader } from '@/components/shell/lontar';

export default function ChatPage() {
  return (
    <div className="flex h-screen flex-col">
      <ScreenHeader crumbs={[{ label: 'Group Chat' }]} right="Chat tim realtime. Agent tidak membaca atau bertindak di sini." />
    <main className="flex min-h-0 flex-1 overflow-hidden bg-white">
      <h1 className="sr-only">Group Chat</h1>
      {/* Channel sidebar */}
      <div className="w-[272px] shrink-0 border-r border-lontar-border bg-lontar-bg">
        <ChannelList />
      </div>

      {/* Empty state */}
      <div className="flex-1 flex flex-col items-center justify-center text-center p-8">
        <div className="mb-4 rounded-full bg-nila-100 p-4">
          <Hash className="h-8 w-8 text-primary" />
        </div>
        <h2 className="text-lg font-semibold">Pilih channel untuk mulai chat</h2>
        <p className="text-sm text-muted-foreground mt-1 max-w-sm">
          Pilih channel dari sidebar kiri untuk melihat pesan dan mulai mengirim chat realtime
        </p>
      </div>
    </main>
    </div>
  );
}
