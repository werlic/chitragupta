// Shared pieces of the R1 "Lontar" canvas (docs/design/r1-canvas): logo, screen header, status chip, labels
import Link from 'next/link';
import type { Role } from '@prisma/client';
import { can } from '@/lib/auth/rbac';
import { cn } from '@/lib/utils';

/** Three-line mark on a Nila square (canvas Main / Login) */
export function LogoMark({ size = 28, className }: { size?: number; className?: string }) {
  const icon = Math.round(size * 0.55);
  return (
    <span
      className={cn('flex shrink-0 items-center justify-center bg-primary', className)}
      style={{ width: size, height: size, borderRadius: size >= 40 ? 12 : 8 }}
      aria-hidden="true"
    >
      <svg width={icon} height={icon} viewBox="0 0 24 24" fill="none" stroke="#FFFFFF" strokeWidth="2.2" strokeLinecap="round">
        <path d="M5 7h14M5 12h9M5 17h6" />
      </svg>
    </span>
  );
}

export function ChevronLeft() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
      <path d="M15 6l-6 6 6 6" />
    </svg>
  );
}

export interface Crumb {
  label: string;
  href?: string;
}

/**
 * Top bar of every secondary screen: "‹ Chat / <screen>" (canvas Review, Tasks, Pending, Meeting).
 * First crumb carries the back chevron; the last crumb without href is the current screen.
 */
export function ScreenHeader({
  back = { label: 'Chat', href: '/dashboard' },
  crumbs,
  title,
  children,
  right,
  white = true,
}: {
  back?: { label: string; href: string };
  crumbs?: Crumb[];
  /** Rendered as h1 after the crumbs (Review) */
  title?: React.ReactNode;
  /** Chips after the title */
  children?: React.ReactNode;
  /** Muted text pushed to the right */
  right?: React.ReactNode;
  white?: boolean;
}) {
  return (
    <header
      className={cn(
        'flex flex-wrap items-center gap-3 border-b border-lontar-border px-8 py-3 max-sm:px-4',
        white ? 'bg-white' : ''
      )}
    >
      <Link href={back.href} className="inline-flex min-h-[40px] items-center gap-1.5 text-sm text-lontar-sub no-underline hover:text-lontar-text">
        <ChevronLeft />
        {back.label}
      </Link>
      {(crumbs || []).map((c, i) => {
        const last = i === (crumbs || []).length - 1 && !title;
        return (
          <span key={`${c.label}-${i}`} className="contents">
            <span className="text-lontar-sep" aria-hidden="true">/</span>
            {c.href ? (
              <Link href={c.href} className="text-sm text-lontar-sub no-underline hover:text-lontar-text">
                {c.label}
              </Link>
            ) : (
              <span className={cn('text-sm', last && (crumbs || []).length > 1 ? 'font-semibold text-lontar-text' : 'text-lontar-sub')} aria-current={last ? 'page' : undefined}>
                {c.label}
              </span>
            )}
          </span>
        );
      })}
      {title && (
        <>
          <span className="text-lontar-sep" aria-hidden="true">/</span>
          <h1 className="m-0 text-base font-semibold">{title}</h1>
        </>
      )}
      {children}
      {right && <span className="ml-auto text-xs text-lontar-mute">{right}</span>}
    </header>
  );
}

// Meeting status chip, same colors everywhere (README token table)
export const MEETING_STATUS: Record<string, { label: string; fg: string; bg: string; dot: string }> = {
  DRAFT: { label: 'Draft', fg: 'text-lontar-sub', bg: 'bg-lontar-muted', dot: 'bg-lontar-mute' },
  PROCESSING: { label: 'Memproses', fg: 'text-lontar-sub', bg: 'bg-lontar-muted', dot: 'bg-lontar-mute' },
  READY: { label: 'Menunggu persetujuan', fg: 'text-info', bg: 'bg-info-soft', dot: 'bg-[#0284C7]' },
  EXECUTED: { label: 'Dieksekusi', fg: 'text-success', bg: 'bg-success-soft', dot: 'bg-success' },
  REJECTED: { label: 'Ditolak', fg: 'text-destructive', bg: 'bg-destructive-soft', dot: 'bg-destructive' },
  UNDONE: { label: 'Dibatalkan', fg: 'text-lontar-sub', bg: 'bg-lontar-muted', dot: 'bg-lontar-mute' },
  PARTIALLY_UNDONE: { label: 'Sebagian dibatalkan', fg: 'text-warning', bg: 'bg-warning-soft', dot: 'bg-warning' },
  FAILED: { label: 'Gagal diproses', fg: 'text-destructive', bg: 'bg-destructive-soft', dot: 'bg-destructive' },
};

export function StatusChip({ status, dot = true, className }: { status: string; dot?: boolean; className?: string }) {
  const s = MEETING_STATUS[status] || { label: status, fg: 'text-lontar-sub', bg: 'bg-lontar-muted', dot: 'bg-lontar-mute' };
  return (
    <span className={cn('inline-flex items-center gap-1.5 whitespace-nowrap rounded-full px-2.5 py-1 text-xs font-semibold', s.fg, s.bg, className)}>
      {dot && <span className={cn('h-1.5 w-1.5 rounded-full', s.dot)} aria-hidden="true" />}
      {s.label}
    </span>
  );
}

/** Chip key for a plan card: an undone run reads "Dibatalkan" instead of "Dieksekusi" */
export function planChipStatus(plan: { status: string; executionState?: string | null }) {
  if (plan.executionState === 'undone') return 'UNDONE';
  if (plan.executionState === 'partially_undone') return 'PARTIALLY_UNDONE';
  return plan.status;
}

export const ROLE_LABEL: Record<string, string> = {
  ADMIN: 'Admin',
  DIRECTOR: 'Direktur',
  MANAGER: 'Manager',
  SECRETARY: 'Sekretaris',
  STAFF: 'Staff',
};

/** "SW" from "Sari Wijaya" */
export function initials(name?: string | null) {
  return (name || '?')
    .split(/\s+/)
    .filter(Boolean)
    .map((n) => n[0])
    .slice(0, 2)
    .join('')
    .toUpperCase();
}

/** Plan hash shortened like the canvas: "3f9a…c21e" */
export function shortHash(hash?: string | null, head = 4, tail = 4) {
  if (!hash) return '';
  return hash.length <= head + tail + 1 ? hash : `${hash.slice(0, head)}…${hash.slice(-tail)}`;
}

/** Page body under a ScreenHeader: centered, canvas max-width and padding */
export function ScreenBody({ max = 1200, className, children }: { max?: 1200 | 1240; className?: string; children: React.ReactNode }) {
  return (
    <div className={cn('mx-auto w-full px-8 max-sm:px-4', max === 1240 ? 'max-w-[1240px] pb-12 pt-8' : 'max-w-[1200px] py-6', className)}>
      {children}
    </div>
  );
}

/** Header note on Tugas: same split as taskScope() in src/lib/auth/task-scope.ts */
export function taskScopeText(role: Role) {
  return can(role, 'meeting:view_all') || can(role, 'task:assign')
    ? 'melihat semua tugas dari semua rapat'
    : 'melihat tugas yang ditugaskan ke Anda & dari rapat yang Anda buat';
}
