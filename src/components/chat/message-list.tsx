'use client';

import { useEffect, useRef } from 'react';
import { MessageBubble } from './message-bubble';
import { useAuthStore } from '@/stores/auth-store';
import type { ChatMessage } from '@/stores/chat-store';

interface MessageListProps {
  messages: ChatMessage[];
  typingUsers?: Array<{ userId: string; userName: string }>;
}

export function MessageList({ messages, typingUsers = [] }: MessageListProps) {
  const { user } = useAuthStore();
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  // Group messages by date
  const grouped: Array<{ date: string; messages: ChatMessage[] }> = [];
  for (const msg of messages) {
    const date = new Date(msg.createdAt).toDateString();
    const lastGroup = grouped[grouped.length - 1];
    if (lastGroup && lastGroup.date === date) {
      lastGroup.messages.push(msg);
    } else {
      grouped.push({ date, messages: [msg] });
    }
  }

  return (
    <div className="flex-1 overflow-y-auto px-4 py-4 space-y-4">
      {grouped.map((group, gi) => (
        <div key={gi} className="space-y-2">
          <div className="sticky top-0 z-10 flex items-center justify-center">
            <span className="bg-card text-xs text-muted-foreground px-2 py-0.5 rounded-full border">
              {new Date(group.date).toLocaleDateString('id-ID', { day: 'numeric', month: 'long', year: 'numeric' })}
            </span>
          </div>
          {group.messages.map((msg, mi) => {
            const prevMsg = mi > 0 ? group.messages[mi - 1] : null;
            const isContinuation = prevMsg && prevMsg.userId === msg.userId && prevMsg.isAI === msg.isAI;
            return (
              <div key={msg.id || mi} className={isContinuation ? 'mt-0.5' : 'mt-3'}>
                <MessageBubble
                  senderName={msg.senderName}
                  senderRole={msg.senderRole}
                  content={msg.content}
                  createdAt={msg.createdAt}
                  isAI={msg.isAI}
                  isOwn={user?.id === msg.userId}
                />
              </div>
            );
          })}
        </div>
      ))}

      {/* Typing indicator */}
      {typingUsers.length > 0 && (
        <div className="flex items-center gap-2 text-sm text-muted-foreground animate-fade-in">
          <div className="flex gap-1">
            <span className="h-2 w-2 rounded-full bg-muted-foreground/50 animate-bounce" style={{ animationDelay: '0ms' }} />
            <span className="h-2 w-2 rounded-full bg-muted-foreground/50 animate-bounce" style={{ animationDelay: '150ms' }} />
            <span className="h-2 w-2 rounded-full bg-muted-foreground/50 animate-bounce" style={{ animationDelay: '300ms' }} />
          </div>
          {typingUsers.map((u) => u.userName).join(', ')} sedang mengetik...
        </div>
      )}

      <div ref={bottomRef} />
    </div>
  );
}
