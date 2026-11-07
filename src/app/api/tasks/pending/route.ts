import { NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/auth';
import { can } from '@/lib/auth/rbac';
import { taskScope } from '@/lib/auth/task-scope';
import { prisma } from '@/lib/db';
import { hashCandidate, hashPlan, isHighImpact } from '@/lib/agent/execution/plan-hash';
import { questionCandidateIds } from '@/lib/agent/types';

type PendingReason = 'needs_clarification' | 'high_impact' | 'rule_warning';

/** Display name of one stored recipient (JSON RecipientInfo, or a bare legacy string). */
function recipientName(raw: string): string {
  try {
    const info = JSON.parse(raw);
    return String(info?.name || info?.email || info?.phone || raw);
  } catch {
    return raw;
  }
}

/**
 * GET /api/tasks/pending
 * Actions waiting for approval: PENDING candidates of READY meetings the user may see
 * (same taskScope as /api/tasks), grouped per plan. Read-only; approval stays in
 * /api/agent/approve.
 */
export async function GET() {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const rows = await prisma.actionCandidate.findMany({
    where: { AND: [taskScope(user), { status: 'PENDING' }, { meeting: { status: 'READY' } }] },
    orderBy: { createdAt: 'asc' },
    include: {
      meeting: {
        select: {
          id: true,
          title: true,
          status: true,
          createdAt: true,
          creatorId: true,
          clarifierQuestions: true,
          clarifierAnswers: true,
          creator: { select: { name: true } },
        },
      },
    },
  });

  const plans = new Map<string, {
    meetingId: string;
    title: string;
    createdAt: Date;
    creatorName: string;
    unansweredQuestions: number;
    canApprove: boolean;
    unansweredFor: Set<string>;
    items: Array<Record<string, unknown>>;
  }>();

  for (const row of rows) {
    const m = row.meeting;
    if (!m || m.status !== 'READY') continue;

    let plan = plans.get(m.id);
    if (!plan) {
      // Same rule as the approve gate: a required question without an answer blocks approval
      const questions = Array.isArray(m.clarifierQuestions) ? (m.clarifierQuestions as any[]) : [];
      const answers = Array.isArray(m.clarifierAnswers) ? (m.clarifierAnswers as any[]) : [];
      const answered = new Set(answers.map((a) => a?.questionId));
      const unanswered = questions.filter((q) => q?.required !== false && !answered.has(q?.id));
      plan = {
        meetingId: m.id,
        title: m.title,
        createdAt: m.createdAt,
        creatorName: m.creator?.name ?? '-',
        unansweredQuestions: unanswered.length,
        // Same rule as the approve route: the plan's creator, or an approver role
        canApprove: m.creatorId === user.userId || can(user.role, 'execution:approve'),
        // A grouped "Budi yang mana?" blocks every action it lists
        unansweredFor: new Set(unanswered.flatMap((q) => questionCandidateIds(q))),
        items: [],
      };
      plans.set(m.id, plan);
    }

    const highImpact = isHighImpact(row);
    const reasons: PendingReason[] = [];
    if (plan.unansweredFor.has(row.candidateId)) reasons.push('needs_clarification');
    if (highImpact) reasons.push('high_impact');
    if (Array.isArray(row.ruleWarnings) && row.ruleWarnings.length > 0) reasons.push('rule_warning');

    plan.items.push({
      id: row.id,
      candidateId: row.candidateId,
      title: row.title,
      actionType: row.actionType,
      owner: row.owner,
      dueDate: row.dueDate ?? null,
      dueTime: row.dueTime ?? null,
      recipients: row.recipients.map(recipientName),
      isExternal: row.isExternal,
      highImpact,
      reasons,
    });
  }

  // The approve gate checks every required question of the meeting. A question that does not
  // point at one of the listed items (LLM 'unknown', or a rejected action) blocks all of them.
  for (const plan of plans.values()) {
    const listed = new Set(plan.items.map((i) => i.candidateId as string));
    const orphan = [...plan.unansweredFor].some((id) => !listed.has(id));
    if (!orphan) continue;
    for (const item of plan.items) {
      const reasons = item.reasons as PendingReason[];
      if (!reasons.includes('needs_clarification')) reasons.unshift('needs_clarification');
    }
  }

  // planHash covers EVERY pending action of the meeting (what Review shows and approve checks),
  // even ones outside this user's task scope; only the hash is returned, not their details
  const allPending = plans.size
    ? await prisma.actionCandidate.findMany({ where: { meetingId: { in: [...plans.keys()] }, status: 'PENDING' } })
    : [];
  const planHash = (meetingId: string) => {
    const rows = allPending.filter((c) => c.meetingId === meetingId);
    return rows.length > 0 ? hashPlan(rows.map((c) => hashCandidate(c))) : null;
  };

  const list = [...plans.values()]
    .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
    .map(({ unansweredFor, ...p }) => ({ ...p, planHash: planHash(p.meetingId) }));

  const items = list.flatMap((p) => p.items as Array<{ reasons: PendingReason[] }>);
  // Approve is gated per meeting: ready only when the whole plan has no open question AND this user may approve it
  const readyPlans = list.filter((p) => p.unansweredQuestions === 0 && p.canApprove);
  const counts = {
    all: items.length,
    needsClarification: items.filter((i) => i.reasons.includes('needs_clarification')).length,
    highImpact: items.filter((i) => i.reasons.includes('high_impact')).length,
    readyToApprove: readyPlans.reduce((n, p) => n + p.items.length, 0),
  };

  return NextResponse.json({ counts, plans: list });
}
