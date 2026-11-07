import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/auth';
import { can } from '@/lib/auth/rbac';
import { prisma } from '@/lib/db';
import { hashCandidate, hashPlan, isHighImpact } from '@/lib/agent/execution/plan-hash';
import { logAudit } from '@/lib/agent/audit-logger';

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { id } = await params;

  const meeting = await prisma.meeting.findUnique({
    where: { id },
    include: {
      creator: { select: { name: true, role: true } },
      candidates: true,
      auditLogs: {
        orderBy: { createdAt: 'desc' },
        take: 20,
      },
    },
  });

  // Same visibility as the meeting list: view_all, own meetings, or tasks assigned to you.
  // Unauthorized and non-existent meetings get the same response.
  const visible =
    meeting &&
    (can(user.role, 'meeting:view_all') ||
      meeting.creatorId === user.userId ||
      meeting.candidates.some((c) => c.assigneeId === user.userId));
  if (!meeting || !visible) {
    return NextResponse.json({ error: 'Meeting tidak ditemukan' }, { status: 404 });
  }

  // Input-guard findings, so the confirmation screen can tell the user what was quarantined
  const injectionLog = await prisma.auditLog.findFirst({
    where: { meetingId: id, type: 'INJECTION_DETECTED' },
    orderBy: { createdAt: 'desc' },
  });
  const quarantinedSegments = ((injectionLog?.payload as any)?.payload?.quarantinedSegments as any[]) || [];

  // planHash binds an approval to exactly these displayed details
  const candidates = meeting.candidates.map((c) => ({
    ...c,
    planHash: hashCandidate(c),
    highImpact: isHighImpact(c),
  }));

  // The confirmation screen is shown with these hashes: record what the user saw
  const pending = candidates.filter((c) => c.status === 'PENDING');
  // Same plan hash the approve route will compute for the PENDING candidates (null: nothing to approve)
  const pendingPlanHash = pending.length > 0 ? hashPlan(pending.map((c) => c.planHash)) : null;
  if (meeting.status === 'READY' && pending.length > 0) {
    await logAudit({
      type: 'CONFIRMATION_SHOWN',
      meetingId: id,
      userId: user.userId,
      payload: {
        planHash: pendingPlanHash,
        candidates: pending.map((c) => ({ candidateId: c.candidateId, planHash: c.planHash, highImpact: c.highImpact })),
      },
    });
  }

  return NextResponse.json({
    meeting: {
      ...meeting,
      candidates,
      pendingPlanHash,
      injectionResult: {
        detected: quarantinedSegments.length > 0,
        quarantinedSegments,
        cleanedText: '',
      },
    },
  });
}
