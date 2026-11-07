import { Loader2 } from 'lucide-react';
import { cn } from '@/lib/utils';

export function Spinner({ className }: { className?: string }) {
  return <Loader2 className={cn('h-5 w-5 animate-spin text-muted-foreground', className)} />;
}

export function LoadingPage({ label = 'Memuat...' }: { label?: string }) {
  return (
    <div className="flex h-full min-h-[400px] flex-col items-center justify-center gap-4">
      <Spinner className="h-8 w-8" />
      <p className="text-sm text-muted-foreground">{label}</p>
    </div>
  );
}
