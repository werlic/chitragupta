'use client';

// Left column of the chat screen (canvas Main.dc.html <aside>): sessions + secondary menu + user card
import { useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import type { Role } from '@prisma/client';
import { can, type Permission } from '@/lib/auth/rbac';
import { useAuthStore, type AuthUser } from '@/stores/auth-store';
import { Dialog } from '@/components/ui/dialog';
import { LogoMark, ROLE_LABEL, initials } from '@/components/shell/lontar';
import { cn } from '@/lib/utils';
import type { ChatSession } from './types';

const ICON = { width: 16, height: 16, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 2, strokeLinecap: 'round' as const, 'aria-hidden': true };

const MENU: { href: string; label: string; perms: Permission[]; icon: React.ReactNode; badge?: 'tasks' | 'pending' }[] = [
  {
    href: '/dashboard/tasks',
    label: 'Tugas',
    perms: ['task:view_own'],
    badge: 'tasks',
    icon: (
      <svg {...ICON}>
        <rect x="4" y="4" width="16" height="16" rx="3" />
        <path d="M8.5 12l2.5 2.5 4.5-5" />
      </svg>
    ),
  },
  {
    href: '/dashboard/tasks/pending',
    label: 'Pending approval',
    perms: ['task:view_own'],
    badge: 'pending',
    icon: (
      <svg {...ICON}>
        <circle cx="12" cy="12" r="8" />
        <path d="M12 8v4l2.5 2" />
      </svg>
    ),
  },
  {
    href: '/dashboard/meetings',
    label: 'Meeting',
    perms: ['meeting:view_own', 'meeting:view_all'],
    icon: (
      <svg {...ICON}>
        <path d="M7 3h7l5 5v13H7z" />
        <path d="M14 3v5h5" />
      </svg>
    ),
  },
  {
    href: '/dashboard/chat',
    label: 'Group Chat',
    perms: ['chat:group'],
    icon: (
      <svg {...ICON}>
        <path d="M4 5h16v11H9l-5 4z" />
      </svg>
    ),
  },
  {
    href: '/dashboard/audit',
    label: 'Audit log',
    perms: ['audit:view'],
    icon: (
      <svg {...ICON}>
        <path d="M6 3h12v18H6z" />
        <path d="M9 8h6M9 12h6M9 16h4" />
      </svg>
    ),
  },
  {
    href: '/dashboard/admin/users',
    label: 'Kelola user',
    perms: ['user:manage'],
    icon: (
      <svg {...ICON}>
        <circle cx="9" cy="8" r="3.5" />
        <path d="M3 20c0-3.3 2.7-6 6-6s6 2.7 6 6M16 4.5a3.5 3.5 0 010 7M21 20c0-2.6-1.6-4.8-4-5.6" />
      </svg>
    ),
  },
  {
    href: '/dashboard/admin/data',
    label: 'Data master',
    perms: ['data:manage'],
    icon: (
      <svg {...ICON}>
        <ellipse cx="12" cy="6" rx="7" ry="3" />
        <path d="M5 6v12c0 1.7 3.1 3 7 3s7-1.3 7-3V6M5 12c0 1.7 3.1 3 7 3s7-1.3 7-3" />
      </svg>
    ),
  },
];

function dayKey(d: Date) {
  return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
}

/** "Hari ini" / "Kemarin" / "7 hari terakhir" / "Lebih lama" by updatedAt */
function groupSessions(sessions: ChatSession[]) {
  const now = new Date();
  const today = dayKey(now);
  const y = new Date(now);
  y.setDate(now.getDate() - 1);
  const yesterday = dayKey(y);
  const weekAgo = now.getTime() - 7 * 86400_000;
  const groups: { label: string; items: ChatSession[] }[] = [
    { label: 'Hari ini', items: [] },
    { label: 'Kemarin', items: [] },
    { label: '7 hari terakhir', items: [] },
    { label: 'Lebih lama', items: [] },
  ];
  const sorted = [...sessions].sort((a, b) => (b.updatedAt || '').localeCompare(a.updatedAt || ''));
  for (const s of sorted) {
    const d = new Date(s.updatedAt);
    const k = Number.isNaN(d.getTime()) ? '' : dayKey(d);
    if (k === today) groups[0].items.push(s);
    else if (k === yesterday) groups[1].items.push(s);
    else if (d.getTime() >= weekAgo) groups[2].items.push(s);
    else groups[3].items.push(s);
  }
  return groups.filter((g) => g.items.length > 0);
}

function SessionRow({
  s,
  active,
  onRename,
  onAskDelete,
}: {
  s: ChatSession;
  active: boolean;
  onRename: (id: string, title: string) => Promise<boolean>;
  onAskDelete: (s: ChatSession) => void;
}) {
  const [menu, setMenu] = useState(false);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(s.title);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!menu) return;
    const close = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setMenu(false);
    };
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, [menu]);

  async function commit() {
    const t = draft.trim();
    setEditing(false);
    if (t && t !== s.title) {
      const ok = await onRename(s.id, t);
      if (!ok) setDraft(s.title);
    } else setDraft(s.title);
  }

  if (editing) {
    return (
      <div className="px-1 py-0.5">
        <input
          autoFocus
          aria-label="Nama sesi chat"
          value={draft}
          maxLength={80}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={commit}
          onKeyDown={(e) => {
            if (e.key === 'Enter') commit();
            if (e.key === 'Escape') {
              setDraft(s.title);
              setEditing(false);
            }
          }}
          className="min-h-[38px] w-full rounded-lg border border-primary bg-white px-3 text-sm outline-none"
        />
      </div>
    );
  }

  return (
    <div ref={ref} className="group relative">
      <Link
        href={`/dashboard?session=${encodeURIComponent(s.id)}`}
        aria-current={active ? 'page' : undefined}
        className={cn(
          'flex min-h-[38px] items-center gap-2 rounded-lg py-0 pl-3 pr-9 text-sm text-lontar-text no-underline hover:bg-lontar-muted',
          active && 'bg-lontar-active font-semibold hover:bg-lontar-active'
        )}
      >
        <span className="min-w-0 flex-1 truncate">{s.title || 'Chat tanpa judul'}</span>
        {s.pendingApproval && (
          <span title="Menunggu persetujuan" className="h-2 w-2 shrink-0 rounded-full bg-[#0284C7]">
            <span className="sr-only">Menunggu persetujuan</span>
          </span>
        )}
      </Link>
      <button
        type="button"
        aria-label={`Menu sesi ${s.title}`}
        aria-haspopup="menu"
        aria-expanded={menu}
        onClick={() => setMenu((v) => !v)}
        className={cn(
          'absolute right-1 top-1/2 flex h-[30px] w-[30px] -translate-y-1/2 items-center justify-center rounded-md text-lontar-mute hover:bg-white hover:text-lontar-text focus-visible:opacity-100',
          menu ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'
        )}
      >
        <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
          <circle cx="5" cy="12" r="1.6" />
          <circle cx="12" cy="12" r="1.6" />
          <circle cx="19" cy="12" r="1.6" />
        </svg>
      </button>
      {menu && (
        <div role="menu" className="absolute right-1 top-[calc(100%+2px)] z-20 flex w-40 flex-col rounded-lg border border-lontar-border bg-white p-1 shadow-md">
          <button
            type="button"
            role="menuitem"
            onClick={() => {
              setMenu(false);
              setEditing(true);
            }}
            className="min-h-[36px] rounded-md px-2.5 text-left text-[13px] hover:bg-lontar-muted"
          >
            Ganti nama
          </button>
          <button
            type="button"
            role="menuitem"
            onClick={() => {
              setMenu(false);
              onAskDelete(s);
            }}
            className="min-h-[36px] rounded-md px-2.5 text-left text-[13px] text-destructive hover:bg-destructive-soft"
          >
            Hapus
          </button>
        </div>
      )}
    </div>
  );
}

export function SessionSidebar({
  user,
  sessions,
  loading,
  unavailable,
  activeId,
  onNew,
  onRename,
  onDelete,
  className,
}: {
  user: AuthUser;
  sessions: ChatSession[];
  loading: boolean;
  /** Sessions endpoint missing or failing */
  unavailable?: boolean;
  activeId: string | null;
  onNew: () => void;
  onRename: (id: string, title: string) => Promise<boolean>;
  onDelete: (id: string) => Promise<boolean>;
  className?: string;
}) {
  const role = user.role as Role;
  const [query, setQuery] = useState('');
  const [taskCount, setTaskCount] = useState<number | null>(null);
  const [pendingCount, setPendingCount] = useState<number | null>(null);
  const [confirm, setConfirm] = useState<ChatSession | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  const canTasks = can(role, 'task:view_own');
  useEffect(() => {
    if (!canTasks) return;
    let cancelled = false;
    const refresh = () => {
      fetch('/api/tasks')
        .then((r) => (r.ok ? r.json() : null))
        .then((d) => !cancelled && setTaskCount(Array.isArray(d?.tasks) ? d.tasks.length : null))
        .catch(() => {});
      fetch('/api/tasks/pending')
        .then((r) => (r.ok ? r.json() : null))
        .then((d) => !cancelled && setPendingCount(typeof d?.counts?.all === 'number' ? d.counts.all : null))
        .catch(() => {});
    };
    refresh();
    window.addEventListener('pending-changed', refresh);
    return () => {
      cancelled = true;
      window.removeEventListener('pending-changed', refresh);
    };
  }, [canTasks]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return q ? sessions.filter((s) => (s.title || '').toLowerCase().includes(q)) : sessions;
  }, [sessions, query]);
  const groups = groupSessions(filtered);
  const menu = MENU.filter((m) => m.perms.some((p) => can(role, p)));

  async function doDelete() {
    if (!confirm) return;
    setDeleting(true);
    setDeleteError(null);
    const ok = await onDelete(confirm.id);
    setDeleting(false);
    if (ok) setConfirm(null);
    else setDeleteError('Sesi belum terhapus. Coba lagi.');
  }

  return (
    <aside
      className={cn('flex h-full w-[272px] shrink-0 flex-col gap-4 border-r border-lontar-border bg-lontar-bg px-3 py-4', className)}
      aria-label="Navigasi chat"
    >
      <div className="flex items-center gap-2.5 px-2 py-1">
        <LogoMark size={28} />
        <span className="text-base font-bold tracking-[-0.01em]">Chitragupta</span>
      </div>

      <button
        type="button"
        onClick={onNew}
        className="flex min-h-[44px] items-center gap-2 rounded-lg border border-lontar-border bg-white px-3 text-sm font-semibold text-lontar-text hover:bg-lontar-head"
      >
        <svg {...ICON}>
          <path d="M12 5v14M5 12h14" />
        </svg>
        Chat baru
      </button>

      <label className="flex min-h-[40px] items-center gap-2 rounded-lg bg-lontar-muted px-3 text-[13px] text-lontar-mute">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
          <circle cx="11" cy="11" r="7" />
          <path d="M20 20l-3.5-3.5" />
        </svg>
        <input
          type="search"
          placeholder="Cari sesi chat"
          aria-label="Cari sesi chat"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          className="w-full border-0 bg-transparent text-lontar-text outline-none placeholder:text-lontar-mute"
        />
      </label>

      <nav aria-label="Sesi chat" className="-mx-1 flex min-h-0 flex-1 flex-col gap-0.5 overflow-y-auto px-1">
        {loading ? (
          <span className="px-3 py-2 text-[13px] text-lontar-mute">Memuat sesi…</span>
        ) : unavailable ? (
          <span className="px-3 py-2 text-[13px] text-lontar-mute">Daftar sesi belum tersedia.</span>
        ) : groups.length === 0 ? (
          <span className="px-3 py-2 text-[13px] text-lontar-mute">{query ? 'Tidak ada sesi yang cocok.' : 'Belum ada sesi. Mulai dengan Chat baru.'}</span>
        ) : (
          groups.map((g, gi) => (
            <div key={g.label} className="flex flex-col gap-0.5">
              <div className={cn('px-3 pb-1 text-xs font-semibold text-lontar-mute', gi === 0 ? 'pt-2' : 'pt-3')}>{g.label}</div>
              {g.items.map((s) => (
                <SessionRow
                  key={s.id}
                  s={s}
                  active={s.id === activeId}
                  onRename={onRename}
                  onAskDelete={(x) => {
                    setDeleteError(null);
                    setConfirm(x);
                  }}
                />
              ))}
            </div>
          ))
        )}
      </nav>

      <nav aria-label="Menu lain" className="flex flex-col gap-0.5 border-t border-lontar-border pt-3">
        {menu.map((m) => {
          const n = m.badge === 'tasks' ? taskCount : m.badge === 'pending' ? pendingCount : null;
          return (
            <Link
              key={m.href}
              href={m.href}
              className="flex min-h-[40px] items-center gap-2.5 rounded-md px-3 text-sm text-lontar-text no-underline hover:bg-lontar-muted"
            >
              {m.icon}
              {m.label}
              {n !== null && n > 0 && m.badge === 'tasks' && <span className="ml-auto text-xs text-lontar-mute">{n}</span>}
              {n !== null && n > 0 && m.badge === 'pending' && (
                <span className="ml-auto rounded-full bg-info-soft px-2 py-px text-xs font-semibold text-info" aria-label={`${n} aksi menunggu approval`}>
                  {n}
                </span>
              )}
            </Link>
          );
        })}
      </nav>

      <UserCard user={user} />

      <Dialog open={!!confirm} onClose={() => !deleting && setConfirm(null)} className="max-w-sm rounded-[14px] p-5">
        <div role="alertdialog" aria-modal="true" aria-labelledby="del-title" className="flex flex-col gap-3">
          <h2 id="del-title" className="text-[15px] font-semibold">
            Hapus sesi chat ini?
          </h2>
          <p className="text-[13px] text-lontar-sub">
            “{confirm?.title}” dan pesannya dihapus dari daftar chat. Tindakan ini tidak bisa dibatalkan.
          </p>
          {deleteError && (
            <p role="alert" className="rounded-md bg-destructive-soft px-2.5 py-2 text-[13px] text-destructive">
              {deleteError}
            </p>
          )}
          <div className="flex justify-end gap-2">
            <button
              type="button"
              onClick={() => setConfirm(null)}
              disabled={deleting}
              className="min-h-[44px] rounded-lg border border-lontar-border bg-white px-4 text-sm"
            >
              Batal
            </button>
            <button
              type="button"
              onClick={doDelete}
              disabled={deleting}
              className="min-h-[44px] rounded-lg bg-destructive px-4 text-sm font-semibold text-white disabled:opacity-60"
            >
              {deleting ? 'Menghapus…' : 'Hapus sesi'}
            </button>
          </div>
        </div>
      </Dialog>
    </aside>
  );
}

export function UserCard({ user }: { user: AuthUser }) {
  const [busy, setBusy] = useState(false);
  const zone = [user.timezone, user.location].filter(Boolean).join(' ');
  return (
    <div className="flex items-center gap-2.5 rounded-lg border border-lontar-border bg-white p-2">
      <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-nila-100 text-[13px] font-bold text-primary">{initials(user.name)}</div>
      <div className="flex min-w-0 flex-1 flex-col">
        <span className="truncate text-[13px] font-semibold">{user.name}</span>
        <span className="truncate text-xs text-lontar-mute">
          {ROLE_LABEL[user.role] ?? user.role}
          {zone ? ` · ${zone}` : ''}
        </span>
      </div>
      <button
        type="button"
        title="Keluar"
        aria-label="Keluar"
        disabled={busy}
        onClick={async () => {
          setBusy(true);
          await useAuthStore.getState().logout();
        }}
        className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-lontar-mute hover:bg-lontar-muted hover:text-lontar-text"
      >
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
          <path d="M15 4h4v16h-4M10 8l-4 4 4 4M6 12h10" />
        </svg>
      </button>
    </div>
  );
}
