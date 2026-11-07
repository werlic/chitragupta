import { prisma } from '@/lib/db';
import { hashCandidate, hashPlan, isHighImpact } from '@/lib/agent/execution/plan-hash';
import { questionCandidateIds } from '@/lib/agent/types';

/**
 * Structured plan shown as a card in the AI chat. Built from the rows stored
 * after the gates (like `b1 plan`), never from what the model proposed.
 * The card is read-only: approval happens on the Review screen only.
 */
export interface PlanCardCandidate {
  candidateId: string;
  title: string;
  actionType: string;
  owner: string;
  dueDate: string | null;
  dueTime: string | null;
  recipients: string[];
  highImpact: boolean;
  status: string;
}

export interface PlanCardQuestion {
  id: string;
  candidateId: string;
  question: string;
  type: string;
  /** Every action this question applies to (grouped "Budi yang mana?"); [candidateId] otherwise */
  candidateIds: string[];
  /** Titles of those actions, for "Berlaku untuk: …" */
  appliesTo?: string[];
  options?: {
    value: string;
    label: string;
    role?: string | null;
    department?: string | null;
    timezone?: string;
    location?: string | null;
  }[];
}

/** What happened after approval, from ExecutionRecord (undo keeps the meeting EXECUTED) */
export type ExecutionState = 'none' | 'executed' | 'undone' | 'partially_undone';

export interface PlanCard {
  meetingId: string;
  title: string;
  status: string;
  statusLabel: string;
  executionState: ExecutionState;
  planHash: string | null;
  reviewUrl: string;
  counts: { actions: number; openItems: number; quarantined: number };
  candidates: PlanCardCandidate[];
  questions: PlanCardQuestion[];
  ruleWarnings: { candidateId: string; message: string }[];
  quarantined: { segmentId: string; text: string }[];
  openItems: string[];
}

// Same states as `b1 status`, in the sentence case the chat canvas uses
const STATUS_LABEL: Record<string, string> = {
  DRAFT: 'Draf',
  PROCESSING: 'Sedang diproses',
  READY: 'Menunggu persetujuan',
  EXECUTED: 'Sudah dieksekusi',
  REJECTED: 'Ditolak / gagal',
};

const EXECUTION_LABEL: Partial<Record<ExecutionState, string>> = {
  undone: 'Dibatalkan',
  partially_undone: 'Sebagian dibatalkan',
};

/**
 * Latest execution per candidate (FAILED ignored): none executed → none, every executed
 * one undone → undone, some → partially_undone, else executed.
 */
async function executionStateOf(candidateRowIds: string[]): Promise<ExecutionState> {
  if (candidateRowIds.length === 0) return 'none';
  const records = await prisma.executionRecord.findMany({
    where: { candidateId: { in: candidateRowIds } },
    orderBy: { executedAt: 'asc' },
    select: { candidateId: true, status: true, executedAt: true },
  });
  const latest = new Map<string, string>();
  for (const r of [...records].sort((a, b) => new Date(a.executedAt).getTime() - new Date(b.executedAt).getTime())) {
    if (r.status === 'SUCCESS' || r.status === 'UNDONE') latest.set(r.candidateId, r.status);
  }
  const states = [...latest.values()];
  if (states.length === 0) return 'none';
  const undone = states.filter((st) => st === 'UNDONE').length;
  if (undone === 0) return 'executed';
  return undone === states.length ? 'undone' : 'partially_undone';
}

export const reviewUrl = (meetingId: string) => `/dashboard/meetings/${meetingId}`;

/** Stored recipients are JSON contact snapshots (or plain strings in old rows): show the name. */
function recipientName(r: string): string {
  try {
    const info = JSON.parse(r);
    return typeof info?.name === 'string' ? info.name : r;
  } catch {
    return r;
  }
}

/** Quarantined lines as logged by the input guard for this meeting. */
async function loggedQuarantine(meetingId: string): Promise<{ segmentId: string; text: string }[]> {
  const log = await prisma.auditLog.findFirst({
    where: { meetingId, type: 'INJECTION_DETECTED' },
    orderBy: { createdAt: 'desc' },
  });
  const segs = ((log?.payload as any)?.payload?.quarantinedSegments as any[]) || [];
  return segs.map((s) => ({ segmentId: String(s.segmentId), text: String(s.text) }));
}

/**
 * Read the plan back from the database. `quarantined` is passed by the caller when
 * it already knows it (audit writes are fire-and-forget, so the log may lag);
 * otherwise it is read from the INJECTION_DETECTED audit entry.
 * Returns null when the meeting no longer exists or does not belong to `ownerId`.
 */
export async function buildPlanCard(
  meetingId: string,
  opts: { ownerId?: string; quarantined?: { segmentId: string; text: string }[] } = {}
): Promise<PlanCard | null> {
  const meeting = await prisma.meeting.findUnique({ where: { id: meetingId }, include: { candidates: true } });
  if (!meeting) return null;
  if (opts.ownerId && meeting.creatorId !== opts.ownerId) return null;

  const rows = [...meeting.candidates].sort((a, b) => a.candidateId.localeCompare(b.candidateId));

  const answered = new Set(((meeting.clarifierAnswers as any[]) || []).map((a) => a?.questionId));
  const questions: PlanCardQuestion[] = ((meeting.clarifierQuestions as any[]) || [])
    .filter((q) => !answered.has(q.id))
    .map((q) => ({
      id: q.id,
      candidateId: q.candidateId,
      question: q.question,
      type: q.type,
      candidateIds: questionCandidateIds(q),
      ...(Array.isArray(q.appliesTo) ? { appliesTo: q.appliesTo } : {}),
      ...(Array.isArray(q.options) ? { options: q.options } : {}),
    }));

  const ruleWarnings = rows.flatMap((c) =>
    ((c.ruleWarnings as any[]) || []).map((w) => ({ candidateId: c.candidateId, message: String(w.message) }))
  );

  const openItems = (((meeting.notulen as any)?.open_items as any[]) || []).map((o) => String(o.title));
  const quarantined = opts.quarantined ?? (await loggedQuarantine(meeting.id));

  // Same hash the Review screen shows (CONFIRMATION_SHOWN); the approved hash once approved
  const pending = rows.filter((c) => c.status === 'PENDING');
  const planHash = meeting.planHash ?? (pending.length > 0 ? hashPlan(pending.map((c) => hashCandidate(c))) : null);

  const executionState = await executionStateOf(rows.map((c) => c.id));

  return {
    meetingId: meeting.id,
    title: meeting.title,
    status: meeting.status,
    statusLabel: EXECUTION_LABEL[executionState] ?? STATUS_LABEL[meeting.status] ?? meeting.status,
    executionState,
    planHash,
    reviewUrl: reviewUrl(meeting.id),
    counts: { actions: rows.length, openItems: openItems.length, quarantined: quarantined.length },
    candidates: rows.map((c) => ({
      candidateId: c.candidateId,
      title: c.title,
      actionType: String(c.actionType).toLowerCase(),
      owner: c.owner,
      dueDate: c.dueDate ?? null,
      dueTime: c.dueTime ?? null,
      recipients: (c.recipients || []).map(recipientName),
      highImpact: isHighImpact(c),
      status: c.status,
    })),
    questions,
    ruleWarnings,
    quarantined,
    openItems,
  };
}
