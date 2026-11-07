import { Avatar } from '@/components/ui/avatar';
import { cn, formatTime } from '@/lib/utils';
import { Bot } from 'lucide-react';

interface MessageBubbleProps {
  senderName: string;
  senderRole?: string;
  content: string;
  createdAt: string;
  isAI?: boolean;
  isOwn?: boolean;
}

export function MessageBubble({ senderName, senderRole, content, createdAt, isAI, isOwn }: MessageBubbleProps) {
  return (
    <div className={cn('flex gap-3 animate-slide-in', isOwn && 'flex-row-reverse')}>
      {isAI ? (
        <div className="h-10 w-10 shrink-0 rounded-full bg-primary flex items-center justify-center text-white">
          <Bot className="h-5 w-5" />
        </div>
      ) : (
        <Avatar name={senderName} size="md" />
      )}
      <div className={cn('flex-1 min-w-0', isOwn && 'flex flex-col items-end')}>
        <div className={cn('flex items-center gap-2 mb-0.5', isOwn && 'flex-row-reverse')}>
          <span className="text-sm font-semibold">{isAI ? 'AI Assistant' : senderName}</span>
          {senderRole && !isAI && (
            <span className="text-xs text-muted-foreground bg-muted px-1.5 py-0.5 rounded">{senderRole}</span>
          )}
          <span className="text-xs text-muted-foreground">{formatTime(createdAt)}</span>
        </div>
        <div
          className={cn(
            'inline-block rounded-lg px-3 py-2 text-sm max-w-[80%]',
            isAI
              ? 'bg-gradient-to-br from-purple-50 to-indigo-50 dark:from-purple-950/30 dark:to-indigo-950/30 text-foreground border border-purple-200 dark:border-purple-800'
              : isOwn
                ? 'bg-primary text-primary-foreground'
                : 'bg-muted text-foreground'
          )}
        >
          <p className="whitespace-pre-wrap break-words">{content}</p>
        </div>
      </div>
    </div>
  );
}
