'use client';

import { useEffect, useState, useRef } from 'react';
import { useParams } from 'next/navigation';
import { ChannelList } from '@/components/chat/channel-list';
import { MessageList } from '@/components/chat/message-list';
import { MessageInput } from '@/components/chat/message-input';
import { useSocket } from '@/lib/chat/socket-client';
import { useAuthStore } from '@/stores/auth-store';
import type { ChatMessage } from '@/stores/chat-store';
import { Hash, Users } from 'lucide-react';
import { ScreenHeader } from '@/components/shell/lontar';

export default function ChatRoomPage() {
  const params = useParams();
  const channelId = params.channelId as string;
  const { user } = useAuthStore();
  const { socket, connected } = useSocket();
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [channel, setChannel] = useState<any>(null);
  const [typingUsers, setTypingUsers] = useState<Array<{ userId: string; userName: string }>>([]);
  const [joinDenied, setJoinDenied] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  // Load channel info and message history
  useEffect(() => {
    async function loadChannel() {
      const [chanRes, msgRes] = await Promise.all([
        fetch('/api/chat/channels').then((r) => r.json()),
        fetch(`/api/chat/channels/${channelId}/messages`).then((r) => r.json()),
      ]);
      const found = chanRes.channels?.find((c: any) => c.id === channelId);
      setChannel(found);
      setMessages(msgRes.messages || []);
    }
    loadChannel();
  }, [channelId]);

  // Join channel room via socket
  useEffect(() => {
    if (!socket || !connected || !user) return;

    setJoinDenied(false);
    socket.emit('join_channel', channelId);

    // Server checks membership on join; denial means no realtime events for this room
    socket.on('join_denied', (data: { channelId?: string }) => {
      if (!data?.channelId || data.channelId === channelId) setJoinDenied(true);
    });

    socket.on('message_received', (data: { message: ChatMessage }) => {
      if (data.message.channelId === channelId) {
        setMessages((prev) => {
          if (prev.some((m) => m.id === data.message.id)) return prev;
          return [...prev, data.message];
        });
      }
    });

    socket.on('user_typing', (data: { userId: string; userName: string; isTyping: boolean }) => {
      setTypingUsers((prev) => {
        if (data.isTyping) {
          if (prev.some((u) => u.userId === data.userId)) return prev;
          return [...prev, { userId: data.userId, userName: data.userName }];
        }
        return prev.filter((u) => u.userId !== data.userId);
      });
    });

    return () => {
      socket.emit('leave_channel', channelId);
      socket.off('message_received');
      socket.off('user_typing');
      socket.off('join_denied');
    };
  }, [socket, connected, channelId, user]);

  async function handleSend(content: string) {
    if (!user || !socket) return;

    const message: ChatMessage = {
      id: `temp-${Date.now()}`,
      channelId,
      userId: user.id,
      senderName: user.name,
      senderRole: user.role,
      content,
      isAI: false,
      createdAt: new Date().toISOString(),
    };

    // Optimistic update
    setMessages((prev) => [...prev, message]);

    // Send via socket for realtime
    socket.emit('send_message', {
      channelId,
      message: { ...message, id: `msg-${Date.now()}` },
    });

    // Also persist via REST API
    try {
      const res = await fetch(`/api/chat/channels/${channelId}/messages`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content }),
      });
      const data = await res.json();
      if (data.message) {
        // Replace temp message with real one
        setMessages((prev) =>
          prev.map((m) => (m.id === message.id ? data.message : m))
        );
      }
    } catch {
      // keep optimistic message
    }
  }

  function handleTyping(isTyping: boolean) {
    if (!socket || !user) return;
    socket.emit('typing', { channelId, userId: user.id, userName: user.name, isTyping });
  }

  return (
    <div className="flex h-screen flex-col">
      <ScreenHeader crumbs={[{ label: 'Group Chat', href: '/dashboard/chat' }, { label: channel?.name ? `#${channel.name}` : 'Channel' }]} />
    <main className="flex min-h-0 flex-1 overflow-hidden bg-white">
      {/* Channel sidebar */}
      <div className="w-[272px] shrink-0 border-r border-lontar-border bg-lontar-bg">
        <ChannelList />
      </div>

      {/* Chat room */}
      <div className="flex min-w-0 flex-1 flex-col">
        {/* Header */}
        <div className="flex items-center gap-2 border-b px-4 py-3">
          <Hash className="h-5 w-5 text-muted-foreground" />
          <div className="flex-1">
            <h1 className="m-0 text-base font-semibold">{channel?.name ? `#${channel.name}` : 'Memuat…'}</h1>
            {channel?.description && (
              <p className="text-xs text-muted-foreground">{channel.description}</p>
            )}
          </div>
          <div className="flex items-center gap-1 text-xs text-muted-foreground">
            <Users className="h-3 w-3" />
            {channel?._count?.members || 0} anggota
          </div>
          <div className={`h-2 w-2 rounded-full ${connected ? 'bg-success' : 'bg-muted-foreground'}`} title={connected ? 'Terhubung' : 'Memutus'} />
        </div>

        {joinDenied && (
          <p role="alert" className="m-0 border-b border-lontar-warnLine bg-lontar-warnBg px-4 py-2 text-[13px] text-warning">
            Koneksi realtime ke channel ini ditolak (bukan anggota atau sesi kedaluwarsa). Pesan baru tidak muncul otomatis; muat ulang halaman.
          </p>
        )}

        {/* Messages */}
        <MessageList messages={messages} typingUsers={typingUsers} />

        {/* Input */}
        <MessageInput onSend={handleSend} onTyping={handleTyping} placeholder={`Pesan ke #${channel?.name || ''}`} />
      </div>
    </main>
    </div>
  );
}
