'use client';

import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import { Dialog } from '@/components/ui/dialog';
import { NotulenView } from '@/components/meeting/notulen-view';
import { CandidateCard } from '@/components/meeting/candidate-card';
import { WarningBanner } from '@/components/meeting/warning-banner';
import { UndoCountdown, ExecutionStatusCard, type ExecutionRef } from '@/components/meeting/undo-countdown';
import { ClarifierForm } from '@/components/meeting/clarifier-form';
import type { ClarifierQuestionData } from '@/components/meeting/clarifier-form';
import { LoadingPage } from '@/components/ui/loading';
import { useAuthStore } from '@/stores/auth-store';
import { can } from '@/lib/auth/rbac';
import type { Role } from '@prisma/client';
import Link from 'next/link';
import { ScreenHeader, StatusChip, shortHash } from '@/components/shell/lontar';
import type { PipelineResult } from '@/lib/agent/types';

type Notice = { tone: 'danger' | 'warning'; title: string; message: string; action?: 'reload' };

function auditType(log: any): string {
  return String(log?.type ?? log?.payload?.type ?? '');
}
function auditPayload(log: any): any {
  return log?.payload?.payload ?? log?.payload ?? {};
}

const ROLE_LABEL: Record<string, string> = {
  ADMIN: 'Admin',
  DIRECTOR: 'Direktur',
  MANAGER: 'Manager',
  SECRETARY: 'Sekretaris',
  STAFF: 'Staff',
};

/** Tell the sidebar's Pending badge to refresh */
function notifyPendingChanged() {
  if (typeof window !== 'undefined') window.dispatchEvent(new Event('pending-changed'));
}

export default function MeetingDetailPage() {
  const params = useParams();
  const meetingId = params.id as string;
  const { user } = useAuthStore();
  const [meeting, setMeeting] = useState<any>(null);
  const [pipelineResult, setPipelineResult] = useState<PipelineResult | null>(null);
  const [loading, setLoading] = useState(true);
  // High-impact confirmation per action (canvas: checkbox inside the action card)
  const [highImpactChecks, setHighImpactChecks] = useState<Record<string, boolean>>({});
  // Chat session this plan came from (for "Kembali ke chat"); optional endpoint
  const [backHref, setBackHref] = useState('/dashboard');
  const [executions, setExecutions] = useState<ExecutionRef[]>([]);
  const [executedAt, setExecutedAt] = useState<number | undefined>();
  const [executionErrors, setExecutionErrors] = useState<Record<string, string>>({});
  const [executing, setExecuting] = useState(false);
  const [clarifierQuestions, setClarifierQuestions] = useState<ClarifierQuestionData[]>([]);
  const [answeredQuestionIds, setAnsweredQuestionIds] = useState<Set<string>>(new Set());
  // Per-candidate plan hash + high-impact flag + DB status from the server (binds approval to displayed details)
  const [approvalMeta, setApprovalMeta] = useState<Record<string, { planHash: string; highImpact: boolean; status: string }>>({});
  const [notice, setNotice] = useState<Notice | null>(null);
  // Reject dialog (canvas States B)
  const [rejectOpen, setRejectOpen] = useState(false);
  const [rejectReason, setRejectReason] = useState('');
  const [rejecting, setRejecting] = useState(false);
  const [rejectError, setRejectError] = useState<string | null>(null);
  const [rejectedBy, setRejectedBy] = useState<string | null>(null);

  function loadMeeting() {
    return fetch(`/api/meetings/${meetingId}`)
      .then((r) => r.json())
      .then((data) => {
        const m = data.meeting;
        setMeeting(m);
        if (!m) return;
        setApprovalMeta(
          Object.fromEntries(
            (m.candidates || []).map((c: any) => [c.candidateId, { planHash: c.planHash, highImpact: c.highImpact, status: c.status }])
          )
        );
        setClarifierQuestions(Array.isArray(m.clarifierQuestions) ? (m.clarifierQuestions as ClarifierQuestionData[]) : []);
        setAnsweredQuestionIds(
          new Set(Array.isArray(m.clarifierAnswers) ? m.clarifierAnswers.map((a: any) => a.questionId) : [])
        );
        // Reconstruct pipeline result from DB data
        if (m.notulen && m.candidates) {
          setPipelineResult({
            meetingId: m.id,
            notulen: m.notulen,
            candidates: m.candidates.map((c: any) => ({
              id: c.candidateId,
              title: c.title,
              owner: c.owner,
              dueDate: c.dueDate || undefined,
              dueTime: c.dueTime || undefined,
              location: c.location || undefined,
              commitmentStatus: (c.commitmentStatus || 'ACCEPTED').toLowerCase() as any,
              evidenceQuote: c.evidenceQuote,
              sourceSegmentId: c.sourceSegmentId,
              actionType: (c.actionType || 'TASK').toLowerCase() as any,
              // Recipients from DB — raw JSON strings for rich display in the card
              recipients: (c.recipients || []) as string[],
              isExternal: c.isExternal,
              recipientCount: c.recipientCount,
            })),
            ruleWarnings: m.candidates.flatMap((c: any) => c.ruleWarnings || []),
            evidenceIssues: m.candidates.flatMap((c: any) => c.validatorResult?.evidenceIssues || []),
            injectionResult: m.injectionResult,
            clarifierQuestions: [],
          });
        } else {
          setPipelineResult(null);
        }
      })
      .finally(() => setLoading(false));
  }

  useEffect(() => {
    loadMeeting();
    fetch('/api/chat/ai/sessions')
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        const s = Array.isArray(d?.sessions) ? d.sessions.find((x: any) => x.lastMeetingId === meetingId) : null;
        if (s?.id) setBackHref(`/dashboard?session=${encodeURIComponent(s.id)}`);
      })
      .catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [meetingId]);

  async function reloadPlan() {
    setNotice(null);
    setHighImpactChecks({});
    await loadMeeting();
  }

  /** Approve = every action still PENDING, in one go (canvas "Approve & jalankan N aksi") */
  async function handleExecute(pendingIds: string[], highImpactConfirmed: boolean) {
    if (pendingIds.length === 0 || !pipelineResult) return;
    setExecuting(true);
    setNotice(null);
    setExecutionErrors({});

    const approved = pendingIds.map((candidateId) => ({
      candidateId,
      planHash: approvalMeta[candidateId]?.planHash || '',
    }));

    try {
      const res = await fetch('/api/agent/approve', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ meetingId, approved, confirmHighImpact: highImpactConfirmed }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        if (data.planChanged) {
          setNotice({
            tone: 'danger',
            title: 'Rencana berubah sejak ditampilkan',
            message: 'Plan hash tidak cocok (409). Muat ulang rencana dan review lagi sebelum approve. Tidak ada aksi yang dijalankan.',
            action: 'reload',
          });
        } else if (data.highImpactRequired) {
          setHighImpactChecks({});
          setNotice({
            tone: 'warning',
            title: 'Konfirmasi dampak tinggi diperlukan',
            message: 'Ada aksi ke penerima eksternal atau lebih dari satu penerima. Centang konfirmasi di kartu aksinya, lalu approve lagi.',
          });
        } else if (data.clarifierRequired) {
          setNotice({
            tone: 'warning',
            title: 'Klarifikasi belum dijawab',
            message: `${data.questionCount ?? 'Beberapa'} pertanyaan wajib dijawab dulu sebelum approve. Tidak ada aksi yang dijalankan.`,
          });
          await loadMeeting();
        } else if (data.rejectedCandidate) {
          setNotice({
            tone: 'danger',
            title: 'Aksi sudah ditolak',
            message: 'Sebagian aksi sudah ditolak dan tidak bisa di-approve. Muat ulang rencana.',
            action: 'reload',
          });
        } else if (res.status === 403) {
          setNotice({
            tone: 'danger',
            title: 'Izin tidak cukup',
            message: `${data.error || 'Peran Anda tidak boleh menyetujui rencana ini.'} Tidak ada aksi yang dijalankan; minta pembuat rencana atau approver.`,
          });
        } else if (res.status === 409) {
          setNotice({ tone: 'danger', title: 'Rencana belum bisa disetujui', message: data.error || 'Status rencana tidak mengizinkan approve.', action: 'reload' });
        } else {
          setNotice({ tone: 'danger', title: 'Persetujuan ditolak server', message: `${data.error || 'Terjadi kesalahan.'} Tidak ada aksi yang dijalankan.` });
        }
        return;
      }

      const results: any[] = Array.isArray(data.results) ? data.results : [];
      const ran: ExecutionRef[] = results
        .filter((r) => r.executionId)
        .map((r) => ({ candidateId: r.candidateId, executionId: r.executionId, undoDeadline: r.undoDeadline }));
      const failed = Object.fromEntries(results.filter((r) => !r.executionId).map((r) => [r.candidateId, r.error || 'Tidak dijalankan.']));
      setExecutionErrors(failed);
      if (ran.length > 0) {
        setExecutions(ran);
        setExecutedAt(Date.now());
      }
      if (Object.keys(failed).length > 0) {
        setNotice({
          tone: 'danger',
          title: ran.length > 0 ? 'Sebagian aksi tidak dijalankan' : 'Tidak ada aksi yang dijalankan',
          message: 'Lihat alasan di kartu aksi (mis. tabel izin per penerima). Aksi yang ditolak izin tetap menunggu.',
        });
      }
      setHighImpactChecks({});
      notifyPendingChanged();
      await loadMeeting();
    } catch {
      setNotice({ tone: 'danger', title: 'Koneksi terputus', message: 'Status approval tidak diketahui. Muat ulang rencana sebelum mencoba lagi.', action: 'reload' });
    } finally {
      setExecuting(false);
    }
  }

  async function handleRejectPlan() {
    setRejecting(true);
    setRejectError(null);
    try {
      const reason = rejectReason.trim();
      const res = await fetch('/api/agent/reject', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ meetingId, ...(reason ? { reason: reason.slice(0, 500) } : {}) }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        if (res.status === 403) setRejectError(data.error || 'Izin tidak cukup untuk menolak rencana ini.');
        else if (res.status === 409) setRejectError(data.error || 'Rencana sudah dieksekusi atau sedang diproses, jadi tidak bisa ditolak.');
        else setRejectError(data.error || 'Gagal menolak rencana.');
        return;
      }
      setRejectOpen(false);
      setRejectedBy(user?.name ?? null);
      notifyPendingChanged();
      setMeeting((m: any) => (m ? { ...m, status: data.meetingStatus || 'REJECTED' } : m));
      await loadMeeting();
    } catch {
      setRejectError('Koneksi terputus. Rencana belum ditolak.');
    } finally {
      setRejecting(false);
    }
  }

  if (loading) return <LoadingPage label="Memuat meeting..." />;
  if (!meeting) {
    return (
      <>
        <ScreenHeader back={{ label: 'Kembali ke chat', href: backHref }} title="Review rencana" />
        <div className="py-12 text-center text-sm text-lontar-mute">Meeting tidak ditemukan atau Anda tidak punya akses.</div>
      </>
    );
  }

  const candidates = pipelineResult?.candidates || [];
  const ruleWarnings = pipelineResult?.ruleWarnings || [];
  const evidenceIssues = pipelineResult?.evidenceIssues || [];
  const auditLogs: any[] = Array.isArray(meeting.auditLogs) ? meeting.auditLogs : [];
  const statusOf = (id: string) => approvalMeta[id]?.status;

  const unanswered = clarifierQuestions.filter((q) => q.required !== false && !answeredQuestionIds.has(q.id));
  const needsClarify = unanswered.length > 0;
  const answeredCount = clarifierQuestions.filter((q) => answeredQuestionIds.has(q.id)).length;

  const parserFailed =
    meeting.status === 'REJECTED' &&
    (candidates.length === 0 ||
      auditLogs.some((l) => auditType(l) === 'PARSER_FAILED'));
  const planRejected = meeting.status === 'REJECTED' && !parserFailed;
  // Reject route logs APPROVAL_REJECTED { reason: 'user_rejected', note, scope }
  const rejectLog = auditLogs.find((l) => auditType(l) === 'APPROVAL_REJECTED' && auditPayload(l)?.reason === 'user_rejected');
  const rejectNote: string = typeof auditPayload(rejectLog)?.note === 'string' ? auditPayload(rejectLog).note : '';
  const rejectUserId: string | undefined = rejectLog?.userId ?? rejectLog?.payload?.userId;
  const rejectRole: string | undefined = auditPayload(rejectLog)?.rejectorRole;
  const rejectorName =
    rejectedBy ||
    (rejectUserId && user && rejectUserId === user.id ? user.name : null) ||
    (rejectUserId && rejectUserId === meeting.creatorId ? meeting.creator?.name : null) ||
    (rejectRole ? `peran ${ROLE_LABEL[rejectRole] ?? rejectRole}` : null);

  // Same rule as the clarify/approve/reject routes: the plan's creator (with meeting:create), or an approver role
  const role = user?.role as Role | undefined;
  const isApprover = !!role && can(role, 'execution:approve');
  const isCreator = !!user && meeting.creatorId === user.id;
  const canAct = isApprover || (isCreator && !!role && can(role, 'meeting:create'));

  const approvable = (id: string) =>
    canAct &&
    !planRejected && !parserFailed && ['READY', 'EXECUTED'].includes(meeting.status) && statusOf(id) === 'PENDING';
  const pendingIds = candidates.filter((c) => approvable(c.id)).map((c) => c.id);
  const pendingCount = candidates.filter((c) => statusOf(c.id) === 'PENDING').length;
  const executedCount = candidates.filter((c) => statusOf(c.id) === 'EXECUTED').length;
  const undoneCount = meeting.status === 'EXECUTED' ? candidates.filter((c) => statusOf(c.id) === 'ACCEPTED').length : 0;
  const canApprove = canAct && !planRejected && !parserFailed && pendingCount > 0 && meeting.status !== 'PROCESSING' && meeting.status !== 'DRAFT';
  const canRejectPlan = canAct && !planRejected && !parserFailed && ['READY', 'DRAFT'].includes(meeting.status);

  const highImpactIds = pendingIds.filter((id) => approvalMeta[id]?.highImpact);
  const needsHighImpactConfirm = highImpactIds.length > 0;
  const highImpactConfirmed = needsHighImpactConfirm && highImpactIds.every((id) => highImpactChecks[id]);
  const quarantined = (pipelineResult?.injectionResult as any)?.quarantinedSegments?.length ?? 0;
  const withIssues = new Set(evidenceIssues.map((e) => e.candidateId)).size;
  const permissionDenied = Object.values(executionErrors).some((e) => /izin/i.test(e));
  const openItems = (pipelineResult?.notulen as any)?.open_items ?? [];
  // One value for what will be approved (GET meeting pendingPlanHash); fallback per action below
  const planHash: string | undefined = meeting.pendingPlanHash || meeting.currentPlanHash || meeting.planHash || undefined;
  const pendingHashes = pendingIds.map((id) => ({ id, hash: approvalMeta[id]?.planHash })).filter((x) => x.hash);

  const blockedReason = needsClarify
    ? `Aktif setelah ${unanswered.length} pertanyaan klarifikasi dijawab.`
    : pendingIds.length === 0
      ? 'Tidak ada aksi yang menunggu approval.'
      : needsHighImpactConfirm && !highImpactConfirmed
        ? 'Aktif setelah konfirmasi dampak tinggi dicentang.'
        : '';

  return (
    <>
      <ScreenHeader back={{ label: 'Kembali ke chat', href: backHref }} title={`Review rencana · ${meeting.title}`}>
        <StatusChip status={parserFailed ? 'FAILED' : meeting.status} />
        {meeting.creator?.name && <span className="ml-auto text-xs text-lontar-mute">oleh {meeting.creator.name}</span>}
      </ScreenHeader>

      <main className="mx-auto flex max-w-[1200px] flex-wrap items-start gap-6 px-8 py-6 max-sm:px-4">
        <div className="flex min-w-0 flex-[999_1_560px] flex-col gap-4">
          {/* Parser failed: nothing to review (canvas States C) */}
          {parserFailed && (
            <div role="alert" className="flex flex-col gap-1.5 rounded-[14px] border border-lontar-border bg-white p-4">
              <strong className="text-sm">Agent tidak bisa membaca teks ini</strong>
              <span className="text-[13px] text-lontar-sub">
                Model AI gagal menyusun kandidat, jadi rapat ini ditandai gagal. Tidak ada aksi yang dibuat atau dijalankan. Kirim
                ulang teks rapat untuk mencoba lagi.
              </span>
              <Link
                href="/dashboard/meetings/new"
                className="inline-flex min-h-[40px] items-center self-start rounded-lg border border-lontar-border bg-white px-3.5 text-[13px] text-lontar-text no-underline hover:bg-lontar-head"
              >
                Kirim ulang teks rapat
              </Link>
            </div>
          )}

          {/* Rejected plan: settled state (canvas States B) */}
          {planRejected && (
            <div role="status" className="flex flex-col gap-2 rounded-[14px] border border-lontar-border bg-white p-4">
              <span className="self-start rounded-full bg-destructive-soft px-2.5 py-1 text-xs font-semibold text-destructive">Ditolak</span>
              <p className="m-0 text-sm">
                Rencana ditolak{rejectorName ? ` oleh ${rejectorName}` : ''}. Tidak ada aksi yang dijalankan. Anda bisa mengirim ulang teks
                rapat di chat.
              </p>
              {rejectNote && <p className="m-0 text-[13px] text-lontar-mute">Alasan: “{rejectNote}”</p>}
            </div>
          )}

          {/* Clarifier — shown while required questions are unanswered */}
          {needsClarify && !planRejected && !parserFailed && canAct && (
            <ClarifierForm
              meetingId={meetingId}
              questions={clarifierQuestions}
              onAnswered={() => {
                // Answers change owner/recipients: reload so the displayed details (and their hashes) are current
                setHighImpactChecks({});
                notifyPendingChanged();
                loadMeeting();
              }}
            />
          )}

          {needsClarify && !planRejected && !parserFailed && !canAct && (
            <div role="note" className="flex flex-col gap-1.5 rounded-[14px] border border-lontar-border bg-white px-5 py-4">
              <span className="self-start rounded-md bg-clarify-soft px-2 py-[3px] text-[11px] font-bold tracking-[0.04em] text-clarify">KLARIFIKASI</span>
              <p className="m-0 text-sm">
                {unanswered.length} pertanyaan belum dijawab. Hanya pembuat rencana atau approver yang dapat menjawab klarifikasi dan
                menyetujui.
              </p>
            </div>
          )}

          {/* Only when there is something to flag: injection / PII (rule warnings sit in each card) */}
          {pipelineResult && <WarningBanner injectionResult={pipelineResult.injectionResult} redactionResult={pipelineResult.redactionResult} />}

          {/* After approve: one undo window, then a settled card (canvas States A) */}
          {executions.length > 0 ? (
            <UndoCountdown
              executions={executions}
              meetingId={meetingId}
              planHash={planHash}
              executedAt={executedAt}
              onUndone={() => loadMeeting()}
            />
          ) : (
            meeting.status === 'EXECUTED' &&
            (executedCount > 0 || undoneCount > 0) && (
              <ExecutionStatusCard
                kind={executedCount === 0 ? 'undone' : undoneCount > 0 ? 'partial' : 'expired'}
                count={executedCount + undoneCount}
                undoneCount={undoneCount}
                executedAt={meeting.updatedAt}
              />
            )
          )}

          {candidates.map((c) => {
            const execResult = executions.find((er) => er.candidateId === c.id);
            const st = statusOf(c.id);
            const high = !!approvalMeta[c.id]?.highImpact;
            return (
              <CandidateCard
                key={c.id}
                candidate={c}
                warnings={ruleWarnings}
                evidenceIssues={evidenceIssues}
                highImpact={high}
                serverStatus={st}
                meetingTitle={meeting.title}
                confirm={
                  high && approvable(c.id) && canApprove
                    ? { checked: !!highImpactChecks[c.id], onChange: (v) => setHighImpactChecks((prev) => ({ ...prev, [c.id]: v })) }
                    : undefined
                }
              >
                {st === 'EXECUTED' && (
                  <div className="rounded-lg bg-success-soft px-3 py-2 text-success">
                    Dieksekusi
                    {execResult ? (
                      <>
                        {' '}
                        · ID eksekusi <span className="font-mono">{execResult.executionId.slice(0, 8)}…</span>
                      </>
                    ) : null}
                  </div>
                )}
                {st === 'ACCEPTED' && meeting.status === 'EXECUTED' && (
                  <div className="rounded-lg bg-lontar-muted px-3 py-2 text-lontar-sub">Dibatalkan lewat undo — tidak dijalankan.</div>
                )}
                {st === 'REJECTED' && <div className="rounded-lg bg-destructive-soft px-3 py-2 text-destructive">Ditolak — tidak akan dijalankan.</div>}
                {executionErrors[c.id] && (
                  <div role="alert" className="flex flex-col gap-0.5 rounded-lg border border-lontar-dangerLine bg-white px-3 py-2">
                    <strong className="text-destructive">{/izin/i.test(executionErrors[c.id]) ? 'Izin tidak cukup' : 'Tidak dijalankan'}</strong>
                    <span className="text-lontar-sub">{executionErrors[c.id]}</span>
                  </div>
                )}
              </CandidateCard>
            );
          })}

          {pipelineResult?.notulen && (
            <details className="group rounded-[14px] border border-lontar-border bg-white">
              <summary className="flex min-h-[48px] cursor-pointer list-none items-center gap-2 px-5 text-[15px] font-semibold">
                <span className="text-lontar-mute transition-transform group-open:rotate-90" aria-hidden="true">›</span>
                Notulen rapat
                <span className="text-xs font-normal text-lontar-mute">dibuat otomatis dari teks rapat</span>
              </summary>
              <div className="border-t border-lontar-line p-1">
                <NotulenView notulen={pipelineResult.notulen} />
              </div>
            </details>
          )}
        </div>

        {/* Approval panel — the only place a plan can be approved */}
        <aside className="flex flex-[1_1_300px] flex-col gap-4">
          <section aria-labelledby="approval-title" className="flex flex-col gap-3.5 rounded-[14px] border border-lontar-border bg-white px-5 py-[18px]">
            <h2 id="approval-title" className="m-0 text-[15px] font-semibold">
              Persetujuan
            </h2>

            <div className="flex flex-col gap-1">
              <span className="text-xs text-lontar-mute">Plan hash (berubah bila rencana diedit)</span>
              {planHash ? (
                <code className="break-all rounded-md bg-lontar-muted px-2.5 py-2 font-mono text-xs" title={planHash}>
                  {shortHash(planHash, 12, 6)}
                </code>
              ) : pendingHashes.length > 0 ? (
                <ul className="m-0 flex list-none flex-col gap-1 rounded-md bg-lontar-muted p-0 px-2.5 py-2">
                  {pendingHashes.map((x) => (
                    <li key={x.id} className="flex items-center justify-between gap-2 font-mono text-xs">
                      <span className="text-lontar-mute">{x.id}</span>
                      <code title={x.hash}>{shortHash(x.hash, 8, 6)}</code>
                    </li>
                  ))}
                </ul>
              ) : (
                <code className="rounded-md bg-lontar-muted px-2.5 py-2 font-mono text-xs text-lontar-mute">—</code>
              )}
            </div>

            <ul className="m-0 flex list-none flex-col gap-2 p-0 text-[13px]">
              <li className="flex justify-between gap-2">
                <span>Kutipan bukti verbatim</span>
                <span className={withIssues ? 'font-semibold text-destructive' : 'font-semibold text-success'}>
                  {candidates.length - withIssues}/{candidates.length}
                </span>
              </li>
              <li className="flex justify-between gap-2">
                <span>Izin per penerima</span>
                <span className={permissionDenied ? 'font-semibold text-destructive' : 'font-semibold text-lontar-mute'}>
                  {permissionDenied ? 'Ditolak' : 'Dicek saat approve'}
                </span>
              </li>
              <li className="flex justify-between gap-2">
                <span>Instruksi tertanam</span>
                <span className={quarantined ? 'font-semibold text-destructive' : 'font-semibold text-success'}>
                  {quarantined ? `${quarantined} dikarantina` : 'Tidak ada'}
                </span>
              </li>
              <li className="flex justify-between gap-2">
                <span>Klarifikasi</span>
                <span className={needsClarify ? 'font-semibold text-clarify' : 'font-semibold text-success'}>
                  {clarifierQuestions.length === 0 ? 'Tidak perlu' : `${answeredCount}/${clarifierQuestions.length} terjawab`}
                </span>
              </li>
              <li className="flex justify-between gap-2">
                <span>Konfirmasi dampak tinggi</span>
                <span className={needsHighImpactConfirm && !highImpactConfirmed ? 'font-semibold text-info' : 'font-semibold text-success'}>
                  {!needsHighImpactConfirm ? 'Tidak perlu' : highImpactConfirmed ? 'Sudah' : 'Belum'}
                </span>
              </li>
            </ul>

            {notice && (
              <div
                role="alert"
                className={`flex flex-col gap-1.5 rounded-[14px] border bg-white p-3.5 ${notice.tone === 'warning' ? 'border-lontar-warnLine' : 'border-lontar-dangerLine'}`}
              >
                <strong className={`text-sm ${notice.tone === 'warning' ? 'text-warning' : 'text-destructive'}`}>{notice.title}</strong>
                <span className="text-[13px] text-lontar-sub">{notice.message}</span>
                {notice.action === 'reload' && (
                  <button
                    type="button"
                    onClick={reloadPlan}
                    className="min-h-[40px] self-start rounded-lg border border-lontar-border bg-white px-3.5 text-[13px] hover:bg-lontar-head"
                  >
                    Muat ulang rencana
                  </button>
                )}
              </div>
            )}

            {!canAct && !planRejected && !parserFailed && (pendingCount > 0 || needsClarify) && (
              <p role="note" className="m-0 rounded-lg bg-lontar-muted px-3 py-2.5 text-[13px] text-lontar-sub">
                Hanya pembuat rencana atau approver yang dapat menjawab klarifikasi dan menyetujui.
              </p>
            )}
            {canApprove && (
              <>
                <button
                  type="button"
                  onClick={() => handleExecute(pendingIds, highImpactConfirmed)}
                  disabled={executing || !!blockedReason}
                  className="min-h-[44px] rounded-lg bg-primary text-sm font-semibold text-white hover:bg-nila-700 disabled:cursor-not-allowed disabled:bg-lontar-disabled"
                >
                  {executing ? 'Menjalankan…' : `Approve & jalankan ${pendingIds.length} aksi`}
                </button>
                <span className="text-xs text-lontar-mute">
                  {blockedReason ? `${blockedReason} ` : ''}Approve langsung menjalankan aksi; undo tersedia 60 detik.
                </span>
              </>
            )}
            {canRejectPlan && (
              <button
                type="button"
                onClick={() => {
                  setRejectError(null);
                  setRejectOpen(true);
                }}
                className="min-h-[44px] rounded-lg border border-lontar-rejectLine bg-white text-sm font-semibold text-destructive hover:bg-destructive-soft"
              >
                Tolak rencana
              </button>
            )}
            {planRejected && <p className="m-0 text-[13px] text-lontar-mute">Rencana ini ditolak. Approve tidak tersedia.</p>}
            {parserFailed && <p className="m-0 text-[13px] text-lontar-mute">Tidak ada rencana untuk di-approve.</p>}
            {!canApprove && !planRejected && !parserFailed && meeting.status === 'EXECUTED' && executions.length === 0 && (
              <p className="m-0 text-[13px] text-lontar-mute">Rencana ini sudah dieksekusi. Tidak ada aksi yang menunggu approval.</p>
            )}
          </section>

          {openItems.length > 0 && (
            <section aria-labelledby="open-title" className="flex flex-col gap-2 rounded-[14px] border border-lontar-border bg-white px-5 py-4 text-[13px]">
              <h2 id="open-title" className="m-0 text-sm font-semibold">
                Open item (tidak dieksekusi)
              </h2>
              {openItems.map((it: any) => (
                <span key={it.id} className="text-lontar-sub">
                  “{it.evidenceQuote || it.title}” · {it.status === 'suggestion' ? 'saran' : it.status === 'question' ? 'pertanyaan' : 'belum spesifik'}
                </span>
              ))}
            </section>
          )}
        </aside>
      </main>

      {/* Reject dialog (canvas States B) */}
      <Dialog open={rejectOpen} onClose={() => !rejecting && setRejectOpen(false)} className="max-w-md rounded-[14px] border-lontar-border p-4">
        <div role="dialog" aria-modal="true" aria-labelledby="reject-title" className="flex flex-col gap-3">
          <h2 id="reject-title" className="m-0 text-[15px] font-semibold">
            Tolak rencana ini?
          </h2>
          <p className="m-0 text-[13px] text-lontar-mute">Semua aksi yang menunggu ditandai ditolak dan tidak akan dijalankan.</p>
          <label htmlFor="reject-reason" className="text-[13px] text-lontar-sub">
            Alasan (opsional, tercatat di audit log)
          </label>
          <textarea
            id="reject-reason"
            rows={3}
            maxLength={500}
            value={rejectReason}
            onChange={(e) => setRejectReason(e.target.value)}
            className="resize-y rounded-lg border border-lontar-input bg-white px-3 py-2.5 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            placeholder="mis. Penerimanya salah, akan saya ketik ulang."
          />
          <span className="text-right text-xs text-lontar-mute">{rejectReason.length}/500</span>
          {rejectError && (
            <div role="alert" className="rounded-lg bg-destructive-soft px-3 py-2 text-[13px] text-destructive">
              {rejectError}
            </div>
          )}
          <div className="flex justify-end gap-2">
            <button
              type="button"
              onClick={() => setRejectOpen(false)}
              disabled={rejecting}
              className="min-h-[44px] rounded-lg border border-lontar-border bg-white px-4 text-sm"
            >
              Batal
            </button>
            <button
              type="button"
              onClick={handleRejectPlan}
              disabled={rejecting}
              className="min-h-[44px] rounded-lg bg-destructive px-4 text-sm font-semibold text-white disabled:opacity-60"
            >
              {rejecting ? 'Menolak…' : 'Tolak rencana'}
            </button>
          </div>
        </div>
      </Dialog>
    </>
  );
}
