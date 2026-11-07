import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { getCurrentUser } from '@/lib/auth';
import { can } from '@/lib/auth/rbac';
import { taskScope } from '@/lib/auth/task-scope';
import { prisma } from '@/lib/db';
import { logAudit } from '@/lib/agent/audit-logger';

export async function GET() {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const where = taskScope(user);

  const tasks = await prisma.actionCandidate.findMany({
    where,
    orderBy: { createdAt: 'desc' },
    include: {
      meeting: { select: { title: true, id: true, status: true, createdAt: true } },
      assignee: { select: { name: true, role: true } },
      executionRecords: { select: { status: true, executedAt: true }, orderBy: { executedAt: 'desc' }, take: 1 },
    },
  });

  // undone: the latest execution of this action was undone (the action itself is ACCEPTED again)
  const withUndo = tasks.map(({ executionRecords, ...task }) => {
    const latest = [...(executionRecords || [])].sort(
      (a, b) => new Date(b.executedAt).getTime() - new Date(a.executedAt).getTime()
    )[0];
    return { ...task, undone: latest?.status === 'UNDONE' };
  });

  return NextResponse.json({ tasks: withUndo });
}

// Only review states may be set here. EXECUTED comes from /api/agent/approve, PENDING is
// never restored (a rejected action must stay rejected), EDITED has no editor behind it.
const PatchSchema = z.object({
  candidateId: z.string().min(1),
  status: z.enum(['ACCEPTED', 'REJECTED']).optional(),
  assigneeId: z.string().min(1).optional(),
});

export async function PATCH(request: NextRequest) {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Body harus JSON' }, { status: 400 });
  }
  const parsed = PatchSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: 'Status hanya boleh ACCEPTED atau REJECTED' }, { status: 400 });
  }
  const { candidateId, status, assigneeId } = parsed.data;

  // Only a task the user can see may change, and only task:assign may reassign it
  const task = await prisma.actionCandidate.findFirst({ where: { AND: [{ id: candidateId }, taskScope(user)] } });
  if (!task) {
    return NextResponse.json({ error: 'Tugas tidak ditemukan' }, { status: 404 });
  }
  if (assigneeId && !can(user.role, 'task:assign')) {
    return NextResponse.json({ error: 'Anda tidak memiliki izin untuk menugaskan ulang' }, { status: 403 });
  }
  if (status && (task.status === 'EXECUTED' || task.status === 'REJECTED')) {
    return NextResponse.json({ error: `Status tugas tidak bisa diubah (status: ${task.status})` }, { status: 409 });
  }

  const updated = await prisma.actionCandidate.update({
    where: { id: candidateId },
    data: {
      ...(status && { status }),
      ...(assigneeId && { assigneeId }),
    },
  });

  if (status === 'REJECTED') {
    await logAudit({
      type: 'APPROVAL_REJECTED',
      meetingId: task.meetingId,
      userId: user.userId,
      payload: { reason: 'user_rejected', note: null, candidates: [task.candidateId], scope: 'task' },
    });
  }

  return NextResponse.json({ task: updated });
}
