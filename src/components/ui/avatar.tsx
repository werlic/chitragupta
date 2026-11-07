import * as React from 'react';
import { cn, initials } from '@/lib/utils';

interface AvatarProps extends React.HTMLAttributes<HTMLDivElement> {
  name: string;
  size?: 'sm' | 'md' | 'lg';
}

const sizeClasses = {
  sm: 'h-8 w-8 text-xs',
  md: 'h-10 w-10 text-sm',
  lg: 'h-12 w-12 text-base',
};

const colorPalette = [
  'bg-indigo-500 text-white',
  'bg-purple-500 text-white',
  'bg-blue-500 text-white',
  'bg-emerald-500 text-white',
  'bg-amber-500 text-white',
  'bg-rose-500 text-white',
  'bg-cyan-500 text-white',
];

function getAvatarColor(name: string): string {
  const hash = name.split('').reduce((acc, c) => acc + c.charCodeAt(0), 0);
  return colorPalette[hash % colorPalette.length];
}

export function Avatar({ name, size = 'md', className, ...props }: AvatarProps) {
  return (
    <div
      className={cn(
        'inline-flex items-center justify-center rounded-full font-semibold shrink-0',
        sizeClasses[size],
        getAvatarColor(name),
        className
      )}
      {...props}
    >
      {initials(name)}
    </div>
  );
}
