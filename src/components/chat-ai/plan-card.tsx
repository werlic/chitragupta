'use client';

// Plan card inside an assistant reply (canvas Main.dc.html). Display only: no button here runs anything.
// Clarifier options open the review screen, where answers are saved and the plan is approved.
import Link from 'next/link';
import { actionTypeOf, formatDateId } from '@/components/meeting/format';
import { shortHash, planChipStatus, StatusChip } from '@/components/shell/lontar';
import type { PlanCardData } from './types';

const PILL = 'whitespace-nowrap rounded-md px-2 py-[3px] text-[11px] font-bold tracking-[0.04em]';

function dueLabel(c: PlanCardData['candidates'][number]) {
  if (!c.dueDate && !c.dueTime) return 'jatuh tempo belum ditentukan';
  if (c.dueTime) return `${c.dueDate ? `${formatDateId(c.dueDate)} · ` : ''}${c.dueTime} WIB`;
  return `jatuh tempo ${formatDateId(c.dueDate)}`;
}

function optionMeta(o: NonNullable<PlanCardData['questions'][number]['options']>[number]) {
  const m = /^(.*?)\s*\(([^)]*)\)\s*$/.exec(o.label);
  const name = m ? m[1] : o.label;
  const meta = [o.role, o.department, o.timezone].filter(Boolean).join(' · ') || (m ? m[2].replace(/,\s*/g, ' · ') : '');
  return { name, meta };
}

type Question = PlanCardData['questions'][number];

/**
 * One entry per distinct question. Uses candidateIds from the server; older plans repeat the same
 * contact question per action, so those are merged by question text + option values.
 */
export function groupQuestions(questions: Question[]): (Question & { ids: string[] })[] {
  const out = new Map<string, Question & { ids: string[] }>();
  for (const q of questions || []) {
    const ids = q.candidateIds?.length ? q.candidateIds : [q.candidateId];
    const key = q.candidateIds?.length
      ? `id:${q.id}`
      : `${q.type}|${q.question}|${(q.options || []).map((o) => o.value).sort().join(',')}`;
    const g = out.get(key);
    if (g) g.ids = Array.from(new Set([...g.ids, ...ids]));
    else out.set(key, { ...q, ids: [...ids] });
  }
  return Array.from(out.values());
}

export function InjectionNote({ segmentId, text }: { segmentId?: string; text: string }) {
  return (
    <div role="note" className="flex items-start gap-2.5 rounded-lg bg-destructive-soft px-3 py-2.5 text-[13px] text-destructive">
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true" className="mt-0.5 shrink-0">
        <path d="M12 3l9 16H3z" />
        <path d="M12 10v4M12 17v.5" />
      </svg>
      <span>
        <strong>Instruksi tertanam diabaikan{segmentId ? ` (${segmentId})` : ''}:</strong> “{text}” Baris ini dikarantina dan tidak menjadi aksi.
      </span>
    </div>
  );
}

export function PlanCard({ plan }: { plan: PlanCardData }) {
  const actions = plan.counts?.actions ?? plan.candidates.length;
  const openItems = plan.counts?.openItems ?? plan.openItems.length;
  const questions = groupQuestions(plan.questions || []);
  // Each question shows once, at the first action it applies to (plan order)
  const order = plan.candidates.map((c) => c.candidateId);
  const firstOf = (q: (typeof questions)[number]) =>
    q.ids.slice().sort((a, b) => (order.indexOf(a) + 1 || 1e9) - (order.indexOf(b) + 1 || 1e9))[0];
  const reviewUrl = plan.reviewUrl || `/dashboard/meetings/${plan.meetingId}`;

  const chip = planChipStatus(plan);
  const footnote =
    chip === 'UNDONE'
      ? 'Aksi dibatalkan lewat undo. Tidak ada yang tetap dijalankan.'
      : chip === 'PARTIALLY_UNDONE'
        ? 'Sebagian aksi dibatalkan lewat undo; sisanya tetap dijalankan.'
        : plan.status === 'EXECUTED'
      ? 'Rencana sudah di-approve dan dijalankan.'
      : plan.status === 'REJECTED'
        ? 'Rencana ditolak. Tidak ada aksi yang dijalankan.'
        : questions.length > 0
          ? `Jawab ${questions.length} pertanyaan sebelum approve.`
          : 'Siap direview. Belum ada yang dikirim.';

  return (
    <div className="overflow-hidden rounded-[14px] border border-lontar-border">
      <div className="flex flex-wrap items-center gap-2.5 border-b border-lontar-border bg-lontar-head px-4 py-3">
        <span className="font-semibold">Rencana aksi</span>
        <span className="text-xs text-lontar-mute">
          {actions} aksi · {openItems} open item
        </span>
        {chip !== 'READY' && <StatusChip status={chip} dot={false} className="py-[3px]" />}
        {plan.planHash && (
          <span className="ml-auto rounded-sm bg-lontar-muted px-2 py-[3px] font-mono text-xs text-lontar-sub" title={`Plan hash ${plan.planHash}`}>
            plan {shortHash(plan.planHash)}
          </span>
        )}
      </div>

      {plan.candidates.length === 0 && (
        <div className="border-b border-lontar-border px-4 py-3.5 text-[13px] text-lontar-mute">Tidak ada aksi yang lolos gerbang.</div>
      )}

      {plan.candidates.map((c) => {
        const type = actionTypeOf(c.actionType);
        const qs = questions.filter((q) => firstOf(q) === c.candidateId);
        const ws = (plan.ruleWarnings || []).filter((w) => w.candidateId === c.candidateId);
        return (
          <div key={c.candidateId} className="flex flex-col gap-2.5 border-b border-lontar-border px-4 py-3.5">
            <div className="flex flex-wrap items-center gap-2">
              <span className={`${PILL} ${type.className}`}>{type.label}</span>
              <span className="font-semibold">{c.title}</span>
              <span className="text-xs text-lontar-mute">{dueLabel(c)}</span>
              {c.highImpact && (
                <span className={`${PILL} bg-warning-soft text-warning`} title="Penerima eksternal atau lebih dari satu penerima: perlu konfirmasi saat approve">
                  DAMPAK TINGGI
                </span>
              )}
            </div>

            {qs.map((q) => (
              <div key={q.id} className="flex flex-col gap-2.5 rounded-lg bg-clarify-soft p-3">
                <span className="text-[13px] font-semibold text-clarify">
                  {q.question}
                  {q.ids.length > 1 && <span className="ml-1.5 font-normal">· berlaku untuk {q.ids.length} aksi</span>}
                </span>
                {q.options && q.options.length > 0 ? (
                  <div className="flex flex-wrap gap-2">
                    {q.options.map((o) => {
                      const { name, meta } = optionMeta(o);
                      return (
                        <Link
                          key={o.value}
                          href={reviewUrl}
                          title="Jawab di layar review"
                          className="flex min-h-[44px] flex-col items-start justify-center gap-0.5 rounded-lg border border-lontar-clarifyLine bg-white px-3 py-2 text-left text-[13px] text-lontar-text no-underline hover:border-clarify"
                        >
                          <span className="font-semibold">{name}</span>
                          {meta && <span className="text-xs text-lontar-mute">{meta}</span>}
                        </Link>
                      );
                    })}
                  </div>
                ) : (
                  <Link href={reviewUrl} className="self-start text-[13px] font-medium text-clarify underline-offset-2 hover:underline">
                    Jawab di layar review
                  </Link>
                )}
              </div>
            ))}

            {ws.map((w, i) => (
              <div key={i} className="flex items-start gap-2 rounded-lg bg-warning-soft px-3 py-2.5 text-[13px] text-warning">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true" className="mt-0.5 shrink-0">
                  <circle cx="12" cy="12" r="9" />
                  <path d="M12 7v5l3 2" />
                </svg>
                <span>{w.message}</span>
              </div>
            ))}
          </div>
        );
      })}

      <div className="-mt-px flex flex-wrap items-center gap-2.5 border-t border-lontar-border bg-lontar-head px-4 py-3">
        <span className="text-xs text-lontar-mute">{footnote}</span>
        <Link
          href={reviewUrl}
          className="ml-auto inline-flex min-h-[40px] items-center rounded-lg bg-primary px-4 text-sm font-semibold text-white no-underline hover:bg-nila-700 hover:text-white"
        >
          Buka review &amp; approval
        </Link>
      </div>
    </div>
  );
}

/** "Open item: “…” dicatat di notulen sebagai saran, bukan aksi." */
export function OpenItemsLine({ items }: { items: string[] }) {
  if (!items || items.length === 0) return null;
  return (
    <p className="m-0 text-[13px] text-lontar-mute">
      Open item: {items.map((t, i) => (
        <span key={i}>
          {i > 0 ? ', ' : ''}“{t}”
        </span>
      ))}{' '}
      dicatat di notulen sebagai saran, bukan aksi.
    </p>
  );
}
