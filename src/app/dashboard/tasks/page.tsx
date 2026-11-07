'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import type { Role } from '@prisma/client';
import { LoadingPage } from '@/components/ui/loading';
import { useAuthStore } from '@/stores/auth-store';
import { ROLE_LABEL, ScreenHeader, taskScopeText } from '@/components/shell/lontar';
import { actionTypeOf, formatDue, PILL, recipientSummary } from '@/components/meeting/format';

const CHIP = 'whitespace-nowrap rounded-full px-2.5 py-0.5 text-xs font-semibold';

// Status chips per canvas Tasks.dc.html. Status changes through approval, not by editing here.
const STATUS: Record<string, { label: string; className: string }> = {
  PENDING: { label: 'Menunggu approval', className: `${CHIP} bg-info-soft text-info` },
  ACCEPTED: { label: 'Disetujui', className: `${CHIP} bg-accent text-accent-foreground` },
  EXECUTED: { label: 'Dieksekusi', className: `${CHIP} bg-success-soft text-success` },
  REJECTED: { label: 'Ditolak', className: `${CHIP} bg-destructive-soft text-destructive` },
  // Undone within the 60 s window: stored as ACCEPTED + undone=true, never ran
  UNDONE: { label: 'Dibatalkan', className: `${CHIP} bg-lontar-muted text-lontar-sub` },
  EDITED: { label: 'Diedit', className: `${CHIP} bg-secondary text-secondary-foreground` },
};
const STATUS_ORDER = ['PENDING', 'ACCEPTED', 'EXECUTED', 'UNDONE', 'REJECTED', 'EDITED'];

type View = 'list' | 'table' | 'board';
type Sort = 'due_asc' | 'due_desc' | 'newest' | 'title';

interface Task {
  id: string;
  meetingId: string;
  candidateId?: string;
  title: string;
  actionType: string;
  status: string;
  owner: string;
  dueDate?: string | null;
  dueTime?: string | null;
  recipients?: string[];
  isExternal?: boolean;
  createdAt?: string;
  assignee?: { name: string; role?: string } | null;
  meeting?: { id: string; title: string; status?: string; createdAt?: string } | null;
}

function dueKey(t: Task) {
  // Tasks without a date sort last when ascending
  return t.dueDate ? `${t.dueDate}T${t.dueTime || '23:59'}` : '9999-12-31';
}

// Canvas toolbar buttons ("Filter: Status ▾"); native selects keep keyboard + screen reader support
const selectClass =
  'h-[34px] cursor-pointer appearance-none rounded-md border border-lontar-border bg-white px-2.5 text-[13px] text-lontar-sub hover:bg-lontar-head focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring';


export default function TasksPage() {
  const { user } = useAuthStore();
  const [tasks, setTasks] = useState<Task[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [pendingCount, setPendingCount] = useState<number | null>(null);
  const [view, setView] = useState<View>('list');
  const [statusFilter, setStatusFilter] = useState('all');
  const [typeFilter, setTypeFilter] = useState('all');
  const [sort, setSort] = useState<Sort>('due_asc');
  const [query, setQuery] = useState('');

  useEffect(() => {
    fetch('/api/tasks')
      .then(async (r) => {
        const data = await r.json().catch(() => ({}));
        if (!r.ok) throw new Error(data.error || 'Gagal memuat tugas.');
        // Display status: an undone action shows as "Dibatalkan", not "Disetujui"
        setTasks((data.tasks || []).map((t: Task & { undone?: boolean }) => (t.undone ? { ...t, status: 'UNDONE' } : t)));
      })
      .catch((e: Error) => setError(e.message))
      .finally(() => setLoading(false));
    fetch('/api/tasks/pending')
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => setPendingCount(typeof d?.counts?.all === 'number' ? d.counts.all : null))
      .catch(() => {});
  }, []);

  const rows = useMemo(() => {
    const q = query.trim().toLowerCase();
    const filtered = tasks.filter((t) => {
      if (statusFilter !== 'all' && t.status !== statusFilter) return false;
      if (typeFilter !== 'all' && (t.actionType || '').toUpperCase() !== typeFilter) return false;
      if (!q) return true;
      return [t.title, t.owner, t.assignee?.name, t.meeting?.title].some((v) => (v || '').toLowerCase().includes(q));
    });
    const sorted = [...filtered];
    if (sort === 'due_asc') sorted.sort((a, b) => dueKey(a).localeCompare(dueKey(b)));
    if (sort === 'due_desc') sorted.sort((a, b) => dueKey(b).localeCompare(dueKey(a)));
    if (sort === 'newest') sorted.sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || ''));
    if (sort === 'title') sorted.sort((a, b) => a.title.localeCompare(b.title, 'id'));
    return sorted;
  }, [tasks, statusFilter, typeFilter, sort, query]);

  const groups = STATUS_ORDER.map((k) => ({ key: k, ...STATUS[k], rows: rows.filter((r) => r.status === k) })).filter(
    (g) => g.rows.length > 0 || (view === 'board' && g.key !== 'EDITED' && g.key !== 'UNDONE')
  );

  const header = (
    <ScreenHeader
      white={false}
      crumbs={[{ label: 'Tugas' }]}
      right={user ? `${user.name} · ${ROLE_LABEL[user.role] ?? user.role} — ${taskScopeText(user.role as Role)}` : undefined}
    >
      {pendingCount !== null && pendingCount > 0 && (
        <Link
          href="/dashboard/tasks/pending"
          className="inline-flex min-h-[32px] items-center rounded-full bg-info-soft px-2.5 text-xs font-semibold text-info no-underline hover:text-info"
        >
          {pendingCount} pending approval
        </Link>
      )}
    </ScreenHeader>
  );

  if (loading)
    return (
      <div className="min-h-screen bg-white">
        {header}
        <LoadingPage label="Memuat tugas..." />
      </div>
    );

  const views: { id: View; label: string }[] = [
    { id: 'list', label: 'List' },
    { id: 'table', label: 'Table' },
    { id: 'board', label: 'Board' },
  ];

  return (
    <div className="min-h-screen bg-white">
      {header}
    <main className="mx-auto flex max-w-[1240px] flex-col gap-4 px-8 pb-12 pt-8 max-sm:px-4">
      <div className="flex items-center gap-3">
        <svg width="30" height="30" viewBox="0 0 24 24" fill="none" stroke="#3B3FB6" strokeWidth="1.8" strokeLinecap="round" aria-hidden="true">
          <rect x="4" y="4" width="16" height="16" rx="3" />
          <path d="M8.5 12l2.5 2.5 4.5-5" />
        </svg>
        <h1 className="m-0 text-[30px] font-bold tracking-[-0.02em]">Tugas</h1>
      </div>
      <p className="m-0 text-sm text-lontar-mute">
        Aksi dari rencana rapat. Properti tetap mengikuti sistem; status berubah lewat approval, bukan diedit bebas.
      </p>

      <div className="flex flex-wrap items-center gap-2 border-b border-lontar-border pb-2">
        <div role="tablist" aria-label="Tampilan" className="flex gap-0.5">
          {views.map((v) => (
            <button
              key={v.id}
              type="button"
              role="tab"
              aria-selected={view === v.id}
              onClick={() => setView(v.id)}
              className={`h-[34px] rounded-md px-3 text-[13px] ${
                view === v.id ? 'bg-lontar-muted font-semibold text-lontar-text' : 'text-lontar-mute hover:bg-lontar-muted/60'
              }`}
            >
              {v.label}
            </button>
          ))}
        </div>
        <div className="ml-auto flex flex-wrap items-center gap-1.5">
          <select aria-label="Filter status" value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} className={selectClass}>
            <option value="all">Filter: Status ▾</option>
            {STATUS_ORDER.map((k) => (
              <option key={k} value={k}>
                {STATUS[k].label}
              </option>
            ))}
          </select>
          <select aria-label="Filter tipe" value={typeFilter} onChange={(e) => setTypeFilter(e.target.value)} className={selectClass}>
            <option value="all">Tipe ▾</option>
            <option value="EMAIL">Email</option>
            <option value="CALENDAR">Kalender</option>
            <option value="TASK">Task</option>
            <option value="WHATSAPP">WhatsApp</option>
          </select>
          <select aria-label="Urutkan" value={sort} onChange={(e) => setSort(e.target.value as Sort)} className={selectClass}>
            <option value="due_asc">Urutkan: Jatuh tempo ↑</option>
            <option value="due_desc">Urutkan: Jatuh tempo ↓</option>
            <option value="newest">Urutkan: Terbaru</option>
            <option value="title">Urutkan: Judul A–Z</option>
          </select>
          <label className="flex h-[34px] items-center gap-1.5 rounded-md bg-lontar-muted px-2.5 text-[13px] text-lontar-mute">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
              <circle cx="11" cy="11" r="7" />
              <path d="M20 20l-3.5-3.5" />
            </svg>
            <input
              type="search"
              placeholder="Cari tugas"
              aria-label="Cari tugas"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              className="w-[120px] border-0 bg-transparent text-lontar-text outline-none placeholder:text-lontar-mute"
            />
          </label>
        </div>
      </div>

      {error && (
        <div role="alert" className="rounded-lg bg-destructive-soft px-3 py-2.5 text-[13px] text-destructive">
          {error}
        </div>
      )}

      {tasks.length === 0 && !error ? (
        <div className="rounded-2xl border border-dashed border-input p-10 text-center text-sm text-muted-foreground">
          Belum ada tugas. Tugas muncul setelah rapat diproses menjadi rencana.
        </div>
      ) : rows.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-input p-10 text-center text-sm text-muted-foreground">
          Tidak ada tugas yang cocok dengan saringan ini.
        </div>
      ) : view === 'list' ? (
        <div className="flex flex-col" role="tabpanel" aria-label="List">
          {groups.map((g) => (
            <section key={g.key} aria-label={g.label} className="mb-4 flex flex-col">
              <div className="flex items-center gap-2 px-1 py-1.5">
                <span className={g.className}>{g.label}</span>
                <span className="text-xs text-muted-foreground">{g.rows.length}</span>
              </div>
              {g.rows.map((t) => {
                const type = actionTypeOf(t.actionType);
                return (
                  <Link
                    key={t.id}
                    href={`/dashboard/meetings/${t.meetingId}`}
                    className="flex min-h-[44px] flex-wrap items-center gap-2.5 border-b border-lontar-line px-2 py-1.5 text-lontar-text no-underline hover:bg-lontar-head"
                  >
                    <span className={`${PILL} ${type.className}`}>{type.label}</span>
                    <span className="min-w-0 flex-[1_1_280px] text-sm font-medium">{t.title}</span>
                    <span className="text-[13px] text-lontar-sub">{t.owner}</span>
                    <span className="min-w-[130px] text-[13px] text-muted-foreground">{formatDue(t.dueDate, t.dueTime) || '—'}</span>
                    <span className="min-w-[180px] text-xs text-muted-foreground">{t.meeting?.title}</span>
                  </Link>
                );
              })}
            </section>
          ))}
        </div>
      ) : view === 'table' ? (
        <div className="overflow-x-auto rounded-lg border" role="tabpanel" aria-label="Table">
          <table className="w-full min-w-[1040px] border-collapse text-[13px]">
            <thead>
              <tr className="bg-background text-left text-muted-foreground">
                {['Judul', 'Tipe', 'Status', 'Pemilik', 'Ditugaskan ke', 'Jatuh tempo', 'Penerima', 'Meeting'].map((h) => (
                  <th key={h} scope="col" className="border-b px-3 py-2.5 font-semibold">
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((t) => {
                const type = actionTypeOf(t.actionType);
                const st = STATUS[t.status] ?? { label: t.status, className: `${CHIP} bg-secondary` };
                return (
                  <tr key={t.id} className="border-b hover:bg-secondary/40">
                    <td className="px-3 py-2.5 font-medium">
                      <Link href={`/dashboard/meetings/${t.meetingId}`} className="hover:underline">
                        {t.title}
                      </Link>
                    </td>
                    <td className="px-3 py-2.5">
                      <span className={`${PILL} ${type.className}`}>{type.label}</span>
                    </td>
                    <td className="px-3 py-2.5">
                      <span className={st.className}>{st.label}</span>
                    </td>
                    <td className="px-3 py-2.5">{t.owner}</td>
                    <td className="px-3 py-2.5 text-muted-foreground">{t.assignee?.name || '—'}</td>
                    <td className="px-3 py-2.5">{formatDue(t.dueDate, t.dueTime) || '—'}</td>
                    <td className="px-3 py-2.5">{recipientSummary(t.recipients, t.isExternal)}</td>
                    <td className="px-3 py-2.5 text-muted-foreground">{t.meeting?.title}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-4 overflow-x-auto sm:grid-cols-2 xl:grid-cols-4" role="tabpanel" aria-label="Board">
          {groups.map((g) => (
            <section key={g.key} aria-label={g.label} className="flex min-w-[240px] flex-col gap-2.5">
              <div className="flex items-center gap-2 p-1">
                <span className={g.className}>{g.label}</span>
                <span className="text-xs text-muted-foreground">{g.rows.length}</span>
              </div>
              {g.rows.map((t) => {
                const type = actionTypeOf(t.actionType);
                return (
                  <Link
                    key={t.id}
                    href={`/dashboard/meetings/${t.meetingId}`}
                    className="flex flex-col gap-2 rounded-lg border bg-card p-3 shadow-sm hover:border-primary/50"
                  >
                    <span className="text-sm font-semibold">{t.title}</span>
                    <span className="flex flex-wrap items-center gap-1.5">
                      <span className={`${PILL} ${type.className}`}>{type.label}</span>
                      <span className="text-xs text-muted-foreground">{formatDue(t.dueDate, t.dueTime) || 'tanpa tanggal'}</span>
                    </span>
                    <span className="text-xs text-lontar-sub">{t.owner}</span>
                    <span className="text-xs text-muted-foreground">{t.meeting?.title}</span>
                  </Link>
                );
              })}
              {g.rows.length === 0 && <span className="px-1 text-xs text-muted-foreground">Kosong</span>}
            </section>
          ))}
        </div>
      )}
    </main>
    </div>
  );
}
