'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { cn } from '@/lib/utils';
import { Hash } from 'lucide-react';
import type { ChatChannel } from '@/stores/chat-store';

export function ChannelList() {
  const pathname = usePathname();
  const [channels, setChannels] = useState<ChatChannel[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch('/api/chat/channels')
      .then((r) => r.json())
      .then((data) => setChannels(data.channels || []))
      .finally(() => setLoading(false));
  }, []);

  const groupChannels = channels.filter((c) => c.type === 'GROUP');

  return (
    <div className="flex flex-col h-full">
      <div className="border-b border-lontar-border px-4 py-3">
        <h2 className="m-0 text-xs font-semibold text-lontar-mute">Channel grup</h2>
      </div>
      <div className="flex-1 overflow-y-auto px-2 py-2 space-y-1">
        {loading ? (
          <p className="text-xs text-muted-foreground px-2 py-4">Memuat...</p>
        ) : (
          <>
            {groupChannels.map((channel) => {
              const active = pathname === `/dashboard/chat/${channel.id}`;
              return (
                <Link
                  key={channel.id}
                  href={`/dashboard/chat/${channel.id}`}
                  className={cn(
                    'flex items-center gap-2 px-2 py-1.5 rounded-md text-sm transition-colors hover:bg-accent',
                    active && 'bg-accent text-accent-foreground font-medium'
                  )}
                >
                  <Hash className="h-4 w-4 text-muted-foreground shrink-0" />
                  <span className="truncate">{channel.name}</span>
                </Link>
              );
            })}

            {groupChannels.length === 0 && <p className="px-2 py-4 text-xs text-muted-foreground">Belum ada channel grup.</p>}
          </>
        )}
      </div>
    </div>
  );
}
