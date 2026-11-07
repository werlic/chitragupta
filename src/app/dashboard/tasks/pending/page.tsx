'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import type { Role } from '@prisma/client';
import { can } from '@/lib/auth/rbac';
import { ROLE_LABEL, ScreenHeader, shortHash } from '@/components/shell/lontar';
import { LoadingPage } from '@/components/ui/loading';
import { useAuthStore } from '@/stores/auth-store';
import { actionTypeOf, formatDue, PILL, timeAgo } from '@/components/meeting/format';

type Reason = 'needs_clarification' | 'high_impact' | 'rule_warning';

interface PendingItem {
  id: string;
  candidateId: string;
  title: string;
  actionType: string;
  owner: string;
  dueDate?: string | null;
  dueTime?: string | null;
  recipients?: string[];
  isExternal?: boolean;
  highImpact?: boolean;
  reasons?: Reason[];
}

interface PendingPlan {
  meetingId: string;
  title: string;
  createdAt: string;
  creatorName?: string;
  unansweredQuestions?: number;
  planHash?: string;
  /** Optional: false when this user may view but not approve the plan */
  canApprove?: boolean;
  items: PendingItem[];
}

interface PendingCounts {
  all: number;
  needsClarification: number;
  highImpact: number;
  readyToApprove: number;
}

type Tab = 'all' | 'clar' | 'high' | 'ready';

const CHIP = 'whitespace-nowrap rounded-full px-2.5 py-0.5 text-xs font-semibold';
const BLOCK = {
  clar: `${CHIP} bg-clarify-soft text-clarify`,
  high: `${CHIP} bg-warning-soft text-warning`,
  ready: `${CHIP} bg-info-soft text-info`,
  waiting: `${CHIP} bg-secondary text-secondary-foreground`,
  rule: `${CHIP} bg-secondary text-secondary-foreground`,
};

const has = (i: PendingItem, r: Reason) => (i.reasons ?? []).includes(r);
// Same split as the API counts: "ready" = nothing left to clarify (high impact still needs the checkbox at approve)
const matches = (i: PendingItem, tab: Tab) =>
  tab === 'all' ||
  (tab === 'clar' && has(i, 'needs_clarification')) ||
  (tab === 'high' && (has(i, 'high_impact') || !!i.highImpact)) ||
  (tab === 'ready' && !has(i, 'needs_clarification'));

function planKind(p: PendingPlan): Exclude<Tab, 'all'> | 'waiting' {
  if ((p.unansweredQuestions ?? 0) > 0 || p.items.some((i) => has(i, 'needs_clarification'))) return 'clar';
  if (p.canApprove === false) return 'waiting';
  if (p.items.some((i) => has(i, 'high_impact') || i.highImpact)) return 'high';
  return 'ready';
}

/** "Siap di-approve" only when nothing is unanswered and this user may approve (field optional) */
const planReady = (p: PendingPlan) => (p.unansweredQuestions ?? 0) === 0 && p.canApprove !== false;

function recipientsLabel(i: PendingItem) {
  const n = i.recipients?.length ?? 0;
  if (n === 0) return i.actionType?.toLowerCase() === 'task' ? i.owner : '—';
  if (i.isExternal) return `${n} · eksternal`;
  if (n === 1) return i.recipients![0];
  return `${n} penerima`;
}

export default function PendingTasksPage() {
  const { user } = useAuthStore();
  const [plans, setPlans] = useState<PendingPlan[]>([]);
  const [counts, setCounts] = useState<PendingCounts | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<Tab>('all');

  useEffect(() => {
    fetch('/api/tasks/pending')
      .then(async (r) => {
        const data = await r.json().catch(() => ({}));
        if (!r.ok) throw new Error(data.error || 'Gagal memuat daftar pending.');
        setPlans(Array.isArray(data.plans) ? data.plans : []);
        setCounts(data.counts ?? null);
      })
      .catch((e: Error) => setError(e.message))
      .finally(() => setLoading(false));
  }, []);

  // Oldest first: the plan that has waited longest is on top
  const sorted = useMemo(
    () => [...plans].sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime()),
    [plans]
  );
  const allItems = sorted.flatMap((p) => p.items);
  const c: PendingCounts = counts ?? {
    all: allItems.length,
    needsClarification: allItems.filter((i) => matches(i, 'clar')).length,
    highImpact: allItems.filter((i) => matches(i, 'high')).length,
    readyToApprove: sorted.filter(planReady).flatMap((p) => p.items).filter((i) => matches(i, 'ready')).length,
  };
  const visible = sorted
    .filter((p) => tab !== 'ready' || planReady(p))
    .map((p) => ({ ...p, items: p.items.filter((i) => matches(i, tab)) }))
    .filter((p) => p.items.length > 0);
  const unansweredTotal = sorted.reduce((s, p) => s + (p.unansweredQuestions ?? 0), 0);
  const oldest = sorted[0]?.createdAt;

  const role = user?.role as Role | undefined;
  const scope =
    role && (can(role, 'meeting:view_all') || can(role, 'task:assign'))
      ? 'melihat semua rencana yang menunggu approval'
      : 'melihat rencana dari rapat yang Anda buat & tugas Anda';
  const header = (
    <ScreenHeader
      crumbs={[{ label: 'Tugas', href: '/dashboard/tasks' }, { label: 'Pending' }]}
      right={user ? `${user.name} · ${ROLE_LABEL[user.role] ?? user.role} — ${scope}` : undefined}
    />
  );

  if (loading)
    return (
      <>
        {header}
        <LoadingPage label="Memuat pending..." />
      </>
    );

  const tabs: { id: Tab; label: string; count: number }[] = [
    { id: 'all', label: 'Semua', count: c.all },
    { id: 'clar', label: 'Perlu klarifikasi', count: c.needsClarification },
    { id: 'high', label: 'Dampak tinggi', count: c.highImpact },
    { id: 'ready', label: 'Siap di-approve', count: c.readyToApprove },
  ];
  const stats = [
    { label: 'Rencana menunggu', value: String(sorted.length), className: '' },
    { label: 'Aksi pending', value: String(c.all), className: '' },
    { label: 'Klarifikasi belum dijawab', value: String(unansweredTotal), className: 'text-clarify' },
    { label: 'Menunggu paling lama', value: oldest ? timeAgo(oldest) : '—', className: 'text-warning' },
  ];

  return (
    <>
      {header}
    <main className="mx-auto flex max-w-[1240px] flex-col gap-5 px-8 pb-12 pt-8 max-sm:px-4">

      <div className="flex flex-col gap-1.5">
        <h1 className="m-0 text-[30px] font-bold tracking-[-0.02em]">To Do pending</h1>
        <p className="m-0 text-sm text-lontar-mute">
          Aksi yang sudah disusun agent tapi <strong className="text-foreground">belum di-approve</strong>. Belum ada yang dikirim.
          Approve dilakukan per rencana di layar review.
        </p>
      </div>

      {error && (
        <div role="alert" className="rounded-lg bg-destructive-soft px-3 py-2.5 text-[13px] text-destructive">
          {error}
        </div>
      )}

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {stats.map((s) => (
          <div key={s.label} className="flex flex-col gap-1 rounded-2xl border border-lontar-border bg-white p-4">
            <span className="text-xs text-lontar-mute">{s.label}</span>
            <span className={`text-[26px] font-bold tracking-[-0.01em] ${s.className}`}>{s.value}</span>
          </div>
        ))}
      </div>

      <div className="flex flex-wrap items-center gap-2 border-b border-lontar-border pb-2">
        <div role="tablist" aria-label="Saring pending" className="flex flex-wrap gap-0.5">
          {tabs.map((t) => {
            const on = tab === t.id;
            return (
              <button
                key={t.id}
                type="button"
                role="tab"
                aria-selected={on}
                onClick={() => setTab(t.id)}
                className={`h-9 rounded-md px-3 text-[13px] ${on ? 'bg-lontar-muted font-semibold text-lontar-text' : 'text-lontar-sub hover:bg-lontar-muted/60'}`}
              >
                {t.label} <span className="font-medium text-lontar-mute">{t.count}</span>
              </button>
            );
          })}
        </div>
        <span className="ml-auto text-[13px] text-lontar-mute">Urut: paling lama menunggu</span>
      </div>

      <div className="flex flex-col gap-4" role="tabpanel">
        {visible.map((p) => {
          const kind = planKind(p);
          const unanswered = p.unansweredQuestions ?? 0;
          const ready = planReady(p);
          const chip =
            kind === 'clar' ? 'Perlu klarifikasi' : kind === 'waiting' ? 'Menunggu approver' : kind === 'high' ? 'Dampak tinggi' : 'Siap di-approve';
          const footnote =
            kind === 'clar'
              ? `Jawab ${unanswered || 'semua'} pertanyaan klarifikasi dulu, lalu approve.`
              : kind === 'waiting'
                ? 'Anda bisa melihat rencana ini; approve dilakukan pembuat rencana atau approver.'
                : kind === 'high'
                ? 'Penerima eksternal atau lebih dari satu penerima: butuh konfirmasi tambahan saat approve.'
                : 'Semua gerbang lolos. Tinggal di-review dan di-approve.';
          return (
            <section key={p.meetingId} aria-labelledby={`plan-${p.meetingId}`} className="overflow-hidden rounded-2xl border border-lontar-border bg-white">
              <div className="flex flex-wrap items-center gap-2.5 border-b border-lontar-line bg-lontar-head px-5 py-3.5">
                <h2 id={`plan-${p.meetingId}`} className="m-0 text-[15px] font-semibold">
                  {p.title}
                </h2>
                <span className={BLOCK[kind]}>{chip}</span>
                <span className="text-xs text-lontar-mute">
                  oleh {p.creatorName || '-'} · {timeAgo(p.createdAt)}
                </span>
                {p.planHash && (
                  <span className="ml-auto rounded-sm bg-lontar-muted px-2 py-[3px] font-mono text-xs text-lontar-sub" title={p.planHash}>
                    plan {shortHash(p.planHash)}
                  </span>
                )}
              </div>
              <ul className="m-0 list-none p-0">
                {p.items.map((i) => {
                  const type = actionTypeOf(i.actionType);
                  const clar = has(i, 'needs_clarification');
                  const high = has(i, 'high_impact') || !!i.highImpact;
                  return (
                    <li key={i.id} className="flex min-h-[48px] flex-wrap items-center gap-2.5 border-b border-lontar-line px-5 py-2">
                      <span className={`${PILL} ${type.className}`}>{type.label}</span>
                      <span className="min-w-0 flex-[1_1_280px] text-sm font-medium">{i.title}</span>
                      <span className="min-w-[150px] text-[13px] text-lontar-sub">{formatDue(i.dueDate, i.dueTime) || 'belum ada tanggal'}</span>
                      <span className="min-w-[110px] text-[13px] text-lontar-sub">{recipientsLabel(i)}</span>
                      <span className="flex flex-wrap gap-1.5">
                        {clar && <span className={BLOCK.clar}>Perlu klarifikasi</span>}
                        {high && <span className={BLOCK.high}>{i.isExternal ? 'Konfirmasi eksternal' : 'Dampak tinggi'}</span>}
                        {has(i, 'rule_warning') && <span className={BLOCK.rule}>Peringatan aturan</span>}
                        {!clar && !high && ready && <span className={BLOCK.ready}>Siap di-approve</span>}
                        {!clar && p.canApprove === false && <span className={BLOCK.waiting}>Menunggu approver</span>}
                      </span>
                    </li>
                  );
                })}
              </ul>
              <div className="flex flex-wrap items-center gap-2.5 px-5 py-3">
                <span className="text-xs text-lontar-mute">{footnote}</span>
                {/* No approve here: approval only happens on the review screen, bound to the plan hash */}
                <Link
                  href={`/dashboard/meetings/${p.meetingId}`}
                  className="ml-auto inline-flex min-h-[40px] items-center rounded-lg bg-primary px-4 text-sm font-semibold text-white no-underline hover:bg-nila-700 hover:text-white"
                >
                  {kind === 'clar' ? 'Jawab & review' : kind === 'waiting' ? 'Lihat rencana' : 'Review & approve'}
                </Link>
              </div>
            </section>
          );
        })}
        {visible.length === 0 && !error && (
          <div className="rounded-2xl border border-dashed border-lontar-input bg-white p-8 text-center text-sm text-lontar-mute">
            {plans.length === 0 ? 'Tidak ada rencana yang menunggu approval.' : 'Tidak ada rencana di saringan ini.'}
          </div>
        )}
      </div>
    </main>
    </>
  );
}
