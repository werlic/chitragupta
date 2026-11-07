import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { getCurrentUser } from '@/lib/auth';
import { can } from '@/lib/auth/rbac';
import { prisma } from '@/lib/db';
import { logAudit } from '@/lib/agent/audit-logger';

const RejectSchema = z
  .object({
    meetingId: z.string().min(1),
    // Omitted → reject the whole plan
    candidateIds: z.array(z.string().min(1)).min(1).optional(),
    reason: z.string().max(500, 'Alasan maksimal 500 karakter').optional(),
  })
  .strict();

/**
 * POST /api/agent/reject
 * The reviewer turns down a plan (or some of its actions). Nothing executes here;
 * rejected candidates can no longer be approved (approve route returns 409).
 */
export async function POST(request: NextRequest) {
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
  const parsed = RejectSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message }, { status: 400 });
  }

  const { meetingId, candidateIds, reason } = parsed.data;

  const meeting = await prisma.meeting.findUnique({ where: { id: meetingId } });
  if (!meeting) {
    return NextResponse.json({ error: 'Meeting tidak ditemukan' }, { status: 404 });
  }

  // Same ownership rule as approve: the plan's creator, or an approver role
  if (meeting.creatorId !== user.userId && !can(user.role, 'execution:approve')) {
    return NextResponse.json({ error: 'Hanya pembuat rencana atau approver yang boleh menolak' }, { status: 403 });
  }

  if (meeting.status === 'EXECUTED' || meeting.status === 'PROCESSING') {
    return NextResponse.json(
      { error: `Rencana tidak bisa ditolak (status: ${meeting.status})`, meetingStatus: meeting.status },
      { status: 409 }
    );
  }

  const rows = await prisma.actionCandidate.findMany({ where: { meetingId } });

  let targets = rows.filter((r) => r.status === 'PENDING');
  if (candidateIds) {
    const requested = new Set(candidateIds);
    const found = rows.filter((r) => requested.has(r.candidateId));
    if (new Set(found.map((r) => r.candidateId)).size !== requested.size) {
      return NextResponse.json({ error: 'Sebagian kandidat tidak ditemukan' }, { status: 404 });
    }
    const executed = found.filter((r) => r.status === 'EXECUTED');
    if (executed.length > 0) {
      return NextResponse.json(
        { error: 'Aksi yang sudah dieksekusi tidak bisa ditolak. Gunakan undo bila masih dalam jendela.', candidates: executed.map((r) => r.candidateId) },
        { status: 409 }
      );
    }
    // Already REJECTED ones are skipped (repeat request is harmless)
    targets = found.filter((r) => r.status !== 'REJECTED');
  }

  const rejected = [...new Set(targets.map((r) => r.candidateId))];
  if (targets.length > 0) {
    await prisma.actionCandidate.updateMany({
      where: { meetingId, id: { in: targets.map((r) => r.id) } },
      data: { status: 'REJECTED' },
    });
  }

  // The plan is rejected when nothing is left waiting for approval
  const stillPending = rows.some((r) => r.status === 'PENDING' && !targets.some((t) => t.id === r.id));
  const meetingStatus = !candidateIds || !stillPending ? 'REJECTED' : meeting.status;
  if (meetingStatus !== meeting.status) {
    await prisma.meeting.update({ where: { id: meetingId }, data: { status: meetingStatus } });
  }

  await logAudit({
    type: 'APPROVAL_REJECTED',
    meetingId,
    userId: user.userId,
    payload: {
      reason: 'user_rejected',
      note: reason ?? null,
      candidates: rejected,
      scope: candidateIds ? 'partial' : 'all',
      meetingStatus,
      rejectorRole: user.role,
    },
  });

  return NextResponse.json({ meetingId, meetingStatus, rejected });
}
