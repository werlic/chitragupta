import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { getCurrentUser } from '@/lib/auth';
import { can } from '@/lib/auth/rbac';
import { prisma } from '@/lib/db';
import { checkExecutionGate, createApprovalToken, ExecutionSecretMissingError } from '@/lib/agent/execution/gate';
import { hashCandidate, hashPlan, isHighImpact } from '@/lib/agent/execution/plan-hash';
import { checkActionPermission, loadPermissionConfig } from '@/lib/agent/execution/permission-gate';
import { executeTool } from '@/lib/agent/tool-mock';
import { logAudit } from '@/lib/agent/audit-logger';

const ApproveSchema = z.object({
  meetingId: z.string(),
  // planHash = hash of the candidate details shown on the confirmation screen
  approved: z.array(z.object({ candidateId: z.string(), planHash: z.string() })).min(1),
  confirmHighImpact: z.boolean().optional(),
});

/**
 * POST /api/agent/approve
 * The ONLY path from a plan to the email/calendar/task/WhatsApp tools.
 */
export async function POST(request: NextRequest) {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  if (!can(user.role, 'execution:approve') && !can(user.role, 'meeting:create')) {
    return NextResponse.json({ error: 'Anda tidak memiliki izin untuk approve execution' }, { status: 403 });
  }

  const body = await request.json();
  const parsed = ApproveSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message }, { status: 400 });
  }

  const { meetingId, approved, confirmHighImpact } = parsed.data;

  const meeting = await prisma.meeting.findUnique({ where: { id: meetingId } });
  if (!meeting) {
    return NextResponse.json({ error: 'Meeting tidak ditemukan' }, { status: 404 });
  }

  // ============ OWNERSHIP: only the plan's creator, or an approver role ============
  if (meeting.creatorId !== user.userId && !can(user.role, 'execution:approve')) {
    await logAudit({
      type: 'APPROVAL_REJECTED',
      meetingId,
      userId: user.userId,
      payload: { reason: 'not_owner' },
    });
    return NextResponse.json({ error: 'Hanya pembuat rencana atau approver yang boleh menyetujui' }, { status: 403 });
  }

  // ============ REJECTED: a rejected action can never be approved afterwards ============
  // Checked before the meeting status so a fully rejected plan gets this specific answer
  const rejectedRows = await prisma.actionCandidate.findMany({
    where: { meetingId, candidateId: { in: approved.map((a) => a.candidateId) }, status: 'REJECTED' },
  });
  if (rejectedRows.length > 0) {
    const ids = [...new Set(rejectedRows.map((c) => c.candidateId))];
    await logAudit({
      type: 'APPROVAL_REJECTED',
      meetingId,
      userId: user.userId,
      payload: { reason: 'candidate_rejected', candidates: ids },
    });
    return NextResponse.json({
      error: 'Aksi ini sudah ditolak dan tidak bisa disetujui.',
      rejectedCandidate: true,
      candidates: ids,
    }, { status: 409 });
  }

  if (meeting.status === 'PROCESSING' || meeting.status === 'DRAFT' || meeting.status === 'REJECTED') {
    return NextResponse.json({ error: `Rencana belum siap disetujui (status: ${meeting.status})` }, { status: 409 });
  }

  // ============ CLARIFIER GATE: block approve if clarifier questions unanswered ============
  const storedQuestions = (meeting.clarifierQuestions as any[]) || [];
  const storedAnswers = (meeting.clarifierAnswers as any[]) || [];

  // Every REQUIRED question must have an answer (not just "any answer exists")
  const answeredIds = new Set(storedAnswers.map((a: any) => a.questionId));
  const unansweredQuestions = storedQuestions.filter(
    (q: any) => q.required !== false && !answeredIds.has(q.id)
  );

  if (unansweredQuestions.length > 0) {
    await logAudit({
      type: 'APPROVAL_REJECTED',
      meetingId,
      userId: user.userId,
      payload: { reason: 'clarifier_unanswered', unanswered: unansweredQuestions.map((q: any) => q.id) },
    });
    return NextResponse.json({
      error: 'Pertanyaan klarifikasi belum dijawab. Jawab dulu sebelum eksekusi.',
      clarifierRequired: true,
      questionCount: unansweredQuestions.length,
      unanswered: unansweredQuestions.map((q: any) => q.id),
    }, { status: 403 });
  }

  // Fetch candidates from DB
  const dbCandidates = await prisma.actionCandidate.findMany({
    where: { meetingId, candidateId: { in: approved.map((a) => a.candidateId) } },
  });

  if (dbCandidates.length !== approved.length) {
    return NextResponse.json({ error: 'Sebagian kandidat tidak ditemukan' }, { status: 404 });
  }

  // ============ PLAN BINDING: approved details must equal what will execute ============
  const hashes = dbCandidates.map((c) => hashCandidate(c));
  const changed = dbCandidates.filter(
    (c, i) => approved.find((a) => a.candidateId === c.candidateId)?.planHash !== hashes[i]
  );
  if (changed.length > 0) {
    await logAudit({
      type: 'APPROVAL_REJECTED',
      meetingId,
      userId: user.userId,
      payload: { reason: 'plan_changed', candidates: changed.map((c) => c.candidateId) },
    });
    return NextResponse.json({
      error: 'Detail aksi berubah sejak ditampilkan. Muat ulang dan periksa lagi sebelum menyetujui.',
      planChanged: true,
      candidates: changed.map((c) => c.candidateId),
    }, { status: 409 });
  }

  // ============ HIGH-IMPACT: external or multiple recipients need explicit confirmation ============
  const highImpact = dbCandidates.filter((c) => isHighImpact(c));
  if (highImpact.length > 0 && !confirmHighImpact) {
    await logAudit({
      type: 'APPROVAL_REJECTED',
      meetingId,
      userId: user.userId,
      payload: { reason: 'high_impact_unconfirmed', candidates: highImpact.map((c) => c.candidateId) },
    });
    return NextResponse.json({
      error: 'Ada aksi berdampak tinggi (penerima eksternal atau lebih dari satu penerima). Konfirmasi tambahan diperlukan.',
      highImpactRequired: true,
      candidates: highImpact.map((c) => c.candidateId),
    }, { status: 409 });
  }

  const planHash = hashPlan(hashes);
  let approvalToken: string;
  try {
    approvalToken = createApprovalToken(planHash);
  } catch (err) {
    if (err instanceof ExecutionSecretMissingError) {
      await logAudit({
        type: 'APPROVAL_REJECTED',
        meetingId,
        userId: user.userId,
        payload: { reason: 'approval_secret_missing', planHash },
      });
      return NextResponse.json(
        { error: 'Server belum dikonfigurasi untuk approval (JWT_SECRET kosong). Tidak ada aksi yang dieksekusi.' },
        { status: 503 }
      );
    }
    throw err;
  }

  await logAudit({
    type: 'APPROVAL_GIVEN',
    meetingId,
    userId: user.userId,
    payload: {
      planHash,
      approverRole: user.role,
      channel: 'web',
      candidates: dbCandidates.map((c, i) => ({ candidateId: c.candidateId, planHash: hashes[i] })),
      highImpactConfirmed: highImpact.length > 0,
    },
  });

  const results: Array<{ candidateId: string; executionId?: string; undoDeadline?: number; error?: string; reason?: string }> = [];
  const permissionConfig = loadPermissionConfig();

  for (const dbC of dbCandidates) {
    const tool = dbC.actionType.toLowerCase() as 'email' | 'calendar' | 'task' | 'whatsapp';

    await logAudit({
      type: 'EXECUTION_REQUESTED',
      meetingId,
      userId: user.userId,
      payload: { candidateId: dbC.candidateId, tool: dbC.actionType, planHash },
    });

    // Permission table (permissions.json): role tool, every recipient's role, contactRules.
    // Fail-closed: an unreadable table refuses with 'permission_config_unavailable'.
    const perm = checkActionPermission(user.role, tool, dbC.recipients, permissionConfig);
    if (!perm.allowed) {
      await logAudit({
        type: 'EXECUTION_FAILED',
        meetingId,
        userId: user.userId,
        payload: { candidateId: dbC.candidateId, tool: dbC.actionType, reason: perm.reason, denied: perm.denied ?? [], message: perm.message },
      });
      results.push({ candidateId: dbC.candidateId, reason: perm.reason, error: `Tidak diizinkan: ${perm.message}` });
      continue;
    }

    // Check execution gate (idempotency)
    const gateCheck = await checkExecutionGate(meetingId, dbC.candidateId, dbC.actionType);
    await logAudit({
      type: 'IDEMPOTENCY_CHECK',
      meetingId,
      userId: user.userId,
      payload: {
        candidateId: dbC.candidateId,
        tool: dbC.actionType,
        alreadyExecuted: !gateCheck.allowed,
        existingExecutionId: gateCheck.existingExecutionId ?? null,
      },
    });
    if (!gateCheck.allowed) {
      results.push({ candidateId: dbC.candidateId, error: gateCheck.reason });
      continue;
    }

    // Execute tool mock
    try {
      const candidate = {
        id: dbC.candidateId,
        title: dbC.title,
        owner: dbC.owner,
        dueDate: dbC.dueDate || undefined,
        dueTime: dbC.dueTime || undefined,
        location: dbC.location || undefined,
        commitmentStatus: dbC.commitmentStatus.toLowerCase() as any,
        evidenceQuote: dbC.evidenceQuote,
        sourceSegmentId: dbC.sourceSegmentId,
        actionType: tool,
        // Read recipients from DB — deserialize JSON strings to RecipientInfo objects
        // then extract email/phone for mock tool execution
        recipients: dbC.recipients.map(r => {
          try {
            const info = JSON.parse(r);
            return info.email || info.phone || info.name;
          } catch {
            return r;
          }
        }),
        isExternal: dbC.isExternal,
        recipientCount: dbC.recipientCount,
      };

      const { executionId, undoDeadline } = await executeTool(meetingId, candidate, dbC.id, user.userId);

      // Update candidate status
      await prisma.actionCandidate.update({
        where: { id: dbC.id },
        data: { status: 'EXECUTED' },
      });

      await logAudit({
        type: 'EXECUTION_SUCCESS',
        meetingId,
        userId: user.userId,
        payload: { candidateId: dbC.candidateId, tool: dbC.actionType, executionId, planHash },
      });

      results.push({ candidateId: dbC.candidateId, executionId, undoDeadline });
    } catch (error) {
      await logAudit({
        type: 'EXECUTION_FAILED',
        meetingId,
        userId: user.userId,
        payload: { candidateId: dbC.candidateId, error: String(error) },
      });
      results.push({ candidateId: dbC.candidateId, error: String(error) });
    }
  }

  // Meeting status reflects what actually ran: EXECUTED only if at least one action
  // executed now. If everything was refused (permission, idempotency), leave it as it was
  // (READY with PENDING candidates, or EXECUTED from an earlier approval).
  const executedNow = results.filter((r) => r.executionId).length;
  if (executedNow > 0) {
    await prisma.meeting.update({
      where: { id: meetingId },
      data: { status: 'EXECUTED', planHash, approvalToken },
    });
  }

  return NextResponse.json({ results, approvalToken });
}
