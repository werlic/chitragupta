import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { getCurrentUser } from '@/lib/auth';
import { can } from '@/lib/auth/rbac';
import { undoExecution } from '@/lib/agent/execution/gate';
import { cancelUndoWindow, deadlineFromExecutedAt } from '@/lib/agent/execution/undo-window';
import { logAudit } from '@/lib/agent/audit-logger';
import { prisma } from '@/lib/db';

const UndoSchema = z.object({
  executionId: z.string(),
  meetingId: z.string().optional(),
});

export async function POST(request: NextRequest) {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  if (!can(user.role, 'execution:undo') && !can(user.role, 'meeting:create')) {
    return NextResponse.json({ error: 'Anda tidak memiliki izin untuk undo' }, { status: 403 });
  }

  const body = await request.json();
  const parsed = UndoSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message }, { status: 400 });
  }

  const { executionId } = parsed.data;

  // Resolve the meeting from the execution itself, so the undo lands in the same audit trail
  const execRecord = await prisma.executionRecord.findUnique({
    where: { id: executionId },
    include: { candidate: { select: { meetingId: true, candidateId: true } } },
  });
  const meetingId = execRecord?.candidate.meetingId ?? parsed.data.meetingId;
  const candidateId = execRecord?.candidate.candidateId;

  await logAudit({
    type: 'UNDO_TRIGGERED',
    meetingId,
    userId: user.userId,
    payload: { executionId, candidateId, tool: execRecord?.tool },
  });

  if (execRecord && execRecord.status === 'UNDONE') {
    return NextResponse.json({ error: 'Aksi ini sudah dibatalkan sebelumnya' }, { status: 409 });
  }

  // Cancel undo window timer. No in-memory entry (dev recompiled the module, server restarted):
  // fall back to the stored execution time + 60 s, so the window is the same either way.
  const cancelled = cancelUndoWindow(executionId);
  const withinStoredWindow =
    !!execRecord && execRecord.status === 'SUCCESS' && Date.now() < deadlineFromExecutedAt(execRecord.executedAt);
  if (!cancelled && !withinStoredWindow) {
    await logAudit({
      type: 'UNDO_WINDOW_EXPIRED',
      meetingId,
      userId: user.userId,
      payload: { executionId, candidateId },
    });
    return NextResponse.json(
      { error: 'Undo window sudah kedaluwarsa (60 detik telah berlalu)' },
      { status: 400 }
    );
  }

  // Undo execution
  const success = await undoExecution(executionId);
  if (!success) {
    return NextResponse.json({ error: 'Execution record tidak ditemukan' }, { status: 404 });
  }

  // Update candidate status back to accepted
  if (execRecord) {
    await prisma.actionCandidate.updateMany({
      where: { id: execRecord.candidateId },
      data: { status: 'ACCEPTED' },
    });
  }

  await logAudit({
    type: 'EXECUTION_UNDONE',
    meetingId,
    userId: user.userId,
    payload: { executionId, candidateId },
  });

  return NextResponse.json({ success: true, executionId });
}
