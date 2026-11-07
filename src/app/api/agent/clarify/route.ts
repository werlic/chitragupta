import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/auth';
import { can } from '@/lib/auth/rbac';
import { prisma } from '@/lib/db';
import { logAudit } from '@/lib/agent/audit-logger';
import { parseDateAnswer } from '@/lib/agent/time-hints';
import { questionCandidateIds } from '@/lib/agent/types';
import { matchContactsByName } from '@/lib/contacts/match';

/**
 * POST /api/agent/clarify
 * Receives user answers to clarifier questions and stores them.
 * Body: { meetingId, answers: [{ questionId, value, label }] }
 *
 * Also sets clarifierAnswers on the Meeting record.
 * Approve endpoint will check if clarifierAnswers exist before allowing execution.
 */
export async function POST(request: NextRequest) {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  if (!can(user.role, 'meeting:create') && !can(user.role, 'execution:approve')) {
    return NextResponse.json({ error: 'Anda tidak memiliki izin untuk menjawab klarifier' }, { status: 403 });
  }

  const body = await request.json();
  const { meetingId, answers } = body as {
    meetingId: string;
    answers: Array<{ questionId: string; value: string; label?: string }>;
  };

  if (!meetingId || !answers || !Array.isArray(answers)) {
    return NextResponse.json({ error: 'meetingId dan answers diperlukan' }, { status: 400 });
  }

  // Fetch meeting to verify it exists and check clarifier questions
  const meeting = await prisma.meeting.findUnique({
    where: { id: meetingId },
  });

  if (!meeting) {
    return NextResponse.json({ error: 'Meeting tidak ditemukan' }, { status: 404 });
  }

  // Answers change who receives an action — same ownership rule as approve
  if (meeting.creatorId !== user.userId && !can(user.role, 'execution:approve')) {
    return NextResponse.json({ error: 'Hanya pembuat rencana atau approver yang boleh menjawab klarifikasi' }, { status: 403 });
  }

  // Answers rewrite recipients and dates: only a plan still awaiting approval may change
  // (never after execution, rejection, or while the pipeline is still running)
  if (meeting.status !== 'READY') {
    return NextResponse.json({
      error: `Rencana tidak bisa diubah lagi (status: ${meeting.status}).`,
      code: 'MEETING_NOT_EDITABLE',
      meetingStatus: meeting.status,
    }, { status: 409 });
  }

  // Verify all required questions are answered
  const storedQuestions = (meeting.clarifierQuestions as any[]) || [];
  const unanswered = storedQuestions.filter((q: any) => {
    if (!q.required) return false;
    return !answers.find(a => a.questionId === q.id);
  });

  if (unanswered.length > 0) {
    return NextResponse.json({
      error: 'Pertanyaan klarifikasi wajib dijawab',
      unanswered: unanswered.map((q: any) => q.id),
    }, { status: 400 });
  }

  // ============ PHASE 1: validate every answer; nothing is written yet ============
  // A refused answer (unknown contact, unreadable date) must leave the plan untouched
  type ContactChoice = { q: any; contact: NonNullable<Awaited<ReturnType<typeof prisma.contact.findUnique>>> };
  type DateChoice = { q: any; dueDate: string; dueTime?: string };
  const contactChoices: ContactChoice[] = [];
  const dateChoices: DateChoice[] = [];
  const commitmentChoices: Array<{ q: any; value: 'accepted' | 'suggestion' }> = [];

  for (const q of storedQuestions) {
    const answer = answers.find(a => a.questionId === q.id);
    if (!answer) continue;
    // One question = one answer: two different values for it (e.g. a different Budi per action) are refused
    const values = new Set(answers.filter((a) => a.questionId === q.id).map((a) => String(a.value)));
    if (values.size > 1) {
      return NextResponse.json({
        error: 'Satu pertanyaan hanya boleh punya satu jawaban (berlaku untuk semua aksi yang disebut).',
        code: 'ANSWER_CONFLICT',
        questionId: q.id,
        unanswered: [q.id],
      }, { status: 400 });
    }

    if (q.type === 'contact_ambiguity') {
      // Only one of the contacts the question offered may be picked
      const offered = new Set<string>((q.options || []).map((o: any) => o.value));
      const contact = offered.size === 0 || offered.has(answer.value)
        ? await prisma.contact.findUnique({ where: { id: answer.value } })
        : null;
      if (!contact) {
        return NextResponse.json({
          error: 'Kontak yang dipilih tidak ditemukan',
          code: 'CONTACT_INVALID',
          questionId: q.id,
          unanswered: [q.id],
        }, { status: 400 });
      }
      contactChoices.push({ q, contact });
    }

    if (q.type === 'missing_due_date') {
      const value = String(answer.value ?? '').trim();
      const hint = parseDateAnswer(value);
      if (hint.conflict || !hint.dueDate) {
        // code covers both "unreadable" and "two different dates" (conflict: true)
        return NextResponse.json({
          error: hint.conflict || `Tanggal "${value}" tidak terbaca. Tulis sebagai "4 November 2026", 4/11/2026, nama hari, atau "besok".`,
          code: 'DATE_UNPARSEABLE',
          ...(hint.conflict ? { conflict: true } : {}),
          questionId: q.id,
          unanswered: [q.id],
        }, { status: 400 });
      }
      dateChoices.push({ q, dueDate: hint.dueDate, dueTime: hint.dueTime });
    }

    if (q.type === 'vague_commitment' && (answer.value === 'accepted' || answer.value === 'suggestion')) {
      commitmentChoices.push({ q, value: answer.value });
    }
  }

  // ============ PHASE 2: apply all answers together (all or nothing) ============
  await prisma.$transaction(async (tx) => {
    // "Which contact?": set the chosen contact as owner + recipient. Replace only the
    // ambiguous matches (the question's options); other recipients (e.g. meeting
    // participants on a calendar invite) stay as shown
    // A grouped question ("Pak Budi" in several actions) applies the ONE chosen contact to all of
    // them; an action naming Budi only as a recipient keeps its owner
    for (const { q, contact } of contactChoices) {
      const ambiguousIds = new Set<string>((q.options || []).map((o: any) => o.value));
      const targets = questionCandidateIds(q);
      const grouped = Array.isArray(q.candidateIds) && q.candidateIds.length > 0;
      const offered = grouped ? await tx.contact.findMany({ where: { id: { in: [...ambiguousIds] } } }) : [];
      const rows = await tx.actionCandidate.findMany({ where: { meetingId, candidateId: { in: targets } } });
      for (const row of rows) {
        // Owner is the ambiguous name when it still matches several of the offered contacts
        const ownerNamed = !grouped || matchContactsByName(offered, row.owner).length > 1;
        const kept = row.recipients.filter((r) => {
          try {
            const info = JSON.parse(r);
            return !ambiguousIds.has(info.contactId) && info.contactId !== contact.id;
          } catch {
            return true;
          }
        });
        const chosen = JSON.stringify({
          contactId: contact.id,
          name: contact.name,
          email: contact.email,
          phone: contact.phone,
          timezone: contact.timezone,
          location: contact.location,
          department: contact.department,
          isExternal: contact.isExternal,
        });
        const recipients = [chosen, ...kept];
        const isExternal = recipients.some((r) => {
          try {
            return JSON.parse(r).isExternal === true;
          } catch {
            return false;
          }
        });
        await tx.actionCandidate.update({
          where: { id: row.id },
          data: {
            ...(ownerNamed
              ? {
                  owner: contact.name,
                  ownerId: contact.id,
                  // The chosen contact's app user (if any) now owns the task; else keep any prior assignment
                  ...(contact.userId ? { assigneeId: contact.userId } : {}),
                }
              : {}),
            recipients,
            recipientCount: recipients.length,
            isExternal,
          },
        });
      }
    }

    // Due-date and commitment answers go to their candidates, so what gets approved
    // is what the user answered
    for (const { q, dueDate, dueTime } of dateChoices) {
      await tx.actionCandidate.updateMany({
        where: { meetingId, candidateId: q.candidateId },
        data: { dueDate, ...(dueTime ? { dueTime } : {}) },
      });
    }
    for (const { q, value } of commitmentChoices) {
      await tx.actionCandidate.updateMany({
        where: { meetingId, candidateId: q.candidateId },
        data: { commitmentStatus: value === 'accepted' ? 'ACCEPTED' : 'SUGGESTION' },
      });
    }

    await tx.meeting.update({
      where: { id: meetingId },
      data: { clarifierAnswers: answers as any },
    });
  });

  // Log audit event
  await logAudit({
    type: 'CLARIFY_ANSWERED',
    meetingId,
    userId: user.userId,
    payload: { answers, questionCount: storedQuestions.length },
  });

  return NextResponse.json({
    success: true,
    meetingId,
    answersCount: answers.length,
  });
}
