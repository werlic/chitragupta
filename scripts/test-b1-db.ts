/**
 * B1 DB integration runner: runs tests/db-cases.json against the real pipeline,
 * gates and Postgres (complements the DB-free `npm run test:b1`).
 *
 *   npm run test:b1:db              # all cases, Mock LLM
 *   npm run test:b1:db -- TC02 TC13 # selected cases
 *
 * 'plan' cases go through runPipelineWithCandidates (the Chitragupta path) on the
 * real database; 'gate' cases call the execution-gate building blocks used by
 * /api/agent/approve. Test meetings are deleted afterwards.
 * Writes a Markdown summary to tests/db-last-run.md. Exit code 1 if any case fails.
 */
import 'dotenv/config';
import Module from 'module';
import { readFileSync, writeFileSync } from 'fs';
import { join } from 'path';

process.env.LLM_PROVIDER = process.env.LLM_PROVIDER || 'mock';

import { prisma } from '@/lib/db';
import { runPipeline, runPipelineWithCandidates } from '@/lib/agent/orchestrator';
import { hashCandidate, hashPlan, isHighImpact, type HashableCandidate } from '@/lib/agent/execution/plan-hash';
import { createApprovalToken, verifyApprovalToken } from '@/lib/agent/execution/gate';
import { checkContactPermission } from '@/lib/agent/execution/permission-gate';
import { checkIdempotency, storeIdempotencyKey } from '@/lib/agent/execution/idempotency';
import { getLLMProvider } from '@/lib/llm';
import type { ActionCandidate } from '@/lib/agent/types';

interface CaseCandidate {
  title: string;
  owner: string;
  actionType: ActionCandidate['actionType'];
  evidenceQuote: string;
  dueDate?: string;
  dueTime?: string;
  location?: string;
  commitmentStatus?: ActionCandidate['commitmentStatus'];
  recipients?: string[];
  isExternal?: boolean;
}

interface Expect {
  kept?: number;
  questions?: string[];
  warnings?: string[];
  noWarnings?: boolean;
  suggestedDate?: string;
  suggestedTime?: string;
  evidence?: string[];
  injection?: boolean;
  redaction?: boolean;
  noExecution?: boolean;
  audit?: string[];
  // contact_ambiguity options stored in meeting.clarifierQuestions carry these fields
  optionFields?: string[];
}

interface TestCase {
  id: string;
  name: string;
  rule: string;
  kind: 'plan' | 'gate';
  text?: string;
  participants?: string[];
  candidates?: CaseCandidate[];
  check?: 'hash_mismatch' | 'high_impact' | 'permission' | 'idempotency' | 'parser_failure' | 'reject_routes' | 'pipeline_failure' | 'clarify_atomic' | 'assignee' | 'chat_sessions' | 'grouped_clarify';
  expect?: Expect;
}

interface CaseResult {
  id: string;
  name: string;
  rule: string;
  pass: boolean;
  failures: string[];
  ms: number;
}

const testMeetingIds: string[] = [];

function toCandidates(list: CaseCandidate[]): ActionCandidate[] {
  return list.map((c, i) => ({
    id: `cand-${String(i + 1).padStart(2, '0')}`,
    title: c.title,
    owner: c.owner,
    dueDate: c.dueDate,
    dueTime: c.dueTime,
    location: c.location,
    commitmentStatus: c.commitmentStatus || 'accepted',
    evidenceQuote: c.evidenceQuote,
    sourceSegmentId: 'seg-01',
    actionType: c.actionType,
    recipients: c.recipients || [],
    isExternal: c.isExternal || false,
    recipientCount: (c.recipients || []).length,
  }));
}

function sameSet(got: string[], want: string[]): boolean {
  const a = [...new Set(got)].sort().join(',');
  const b = [...new Set(want)].sort().join(',');
  return a === b;
}

async function runPlan(tc: TestCase, user: { id: string; name: string }): Promise<string[]> {
  const exp = tc.expect || {};
  const failures: string[] = [];

  const result = await runPipelineWithCandidates({
    title: `[test:b1:db] ${tc.id}`,
    text: tc.text || '',
    participants: tc.participants || [],
    userId: user.id,
    userName: user.name,
    candidates: toCandidates(tc.candidates || []),
  });
  testMeetingIds.push(result.meetingId);

  const stored = await prisma.actionCandidate.findMany({ where: { meetingId: result.meetingId } });
  const questionTypes = result.clarifierQuestions.map((q) => q.type);
  const warningTypes = result.ruleWarnings.map((w) => w.type);
  const gates = result.evidenceIssues.map((e) => e.gate);

  if (exp.kept !== undefined && stored.length !== exp.kept) {
    failures.push(`kandidat tersimpan ${stored.length}, harusnya ${exp.kept}`);
  }
  if (exp.questions && !sameSet(questionTypes, exp.questions)) {
    failures.push(`pertanyaan [${questionTypes.join(',')}], harusnya [${exp.questions.join(',')}]`);
  }
  for (const w of exp.warnings || []) {
    if (!warningTypes.includes(w as any)) failures.push(`peringatan ${w} tidak muncul (dapat [${warningTypes.join(',')}])`);
  }
  if (exp.noWarnings && warningTypes.length > 0) {
    failures.push(`ada peringatan tak terduga [${warningTypes.join(',')}]`);
  }
  if (exp.suggestedDate && !result.ruleWarnings.some((w) => w.suggestedDate === exp.suggestedDate)) {
    failures.push(`usulan tanggal ${exp.suggestedDate} tidak ada (dapat [${result.ruleWarnings.map((w) => w.suggestedDate).filter(Boolean).join(',')}])`);
  }
  if (exp.suggestedTime && !result.ruleWarnings.some((w) => w.suggestedTime === exp.suggestedTime)) {
    failures.push(`usulan jam ${exp.suggestedTime} tidak ada (dapat [${result.ruleWarnings.map((w) => w.suggestedTime).filter(Boolean).join(',')}])`);
  }
  for (const g of exp.evidence || []) {
    if (!gates.includes(g as any)) failures.push(`gerbang bukti ${g} tidak terpicu (dapat [${gates.join(',')}])`);
  }
  if (exp.injection !== undefined && !!result.injectionResult?.detected !== exp.injection) {
    failures.push(`injeksi terdeteksi=${!!result.injectionResult?.detected}, harusnya ${exp.injection}`);
  }
  if (exp.redaction !== undefined && !!result.redactionResult?.detected !== exp.redaction) {
    failures.push(`redaksi=${!!result.redactionResult?.detected}, harusnya ${exp.redaction}`);
  }
  if (exp.noExecution) {
    const executions = await prisma.executionRecord.count({ where: { candidate: { meetingId: result.meetingId } } });
    const notPending = stored.filter((c) => c.status !== 'PENDING').length;
    if (executions > 0) failures.push(`${executions} eksekusi tool sebelum approval`);
    if (notPending > 0) failures.push(`${notPending} kandidat tidak berstatus PENDING`);
  }
  if (exp.optionFields) {
    const meeting = await prisma.meeting.findUnique({ where: { id: result.meetingId } });
    const storedQs = (meeting?.clarifierQuestions as any[]) || [];
    const q = storedQs.find((x) => x.type === 'contact_ambiguity');
    if (!q) failures.push('pertanyaan contact_ambiguity tidak tersimpan');
    for (const o of q?.options || []) {
      const missing = exp.optionFields.filter((f) => !(f in o));
      if (missing.length > 0) failures.push(`opsi ${o.value} tanpa field ${missing.join(',')}`);
    }
  }
  if (exp.audit) {
    // Audit DB writes are fire-and-forget; give them a moment to land.
    await new Promise((r) => setTimeout(r, 500));
    const logs = await prisma.auditLog.findMany({ where: { meetingId: result.meetingId }, select: { type: true } });
    const types = logs.map((l) => l.type);
    const missing = exp.audit.filter((t) => !types.includes(t));
    if (missing.length > 0) failures.push(`event audit hilang: ${missing.join(', ')}`);
  }

  return failures;
}

type DbUser = { id: string; name: string; email: string; role: string };
let currentUser: DbUser | null = null;

/** Replace '@/lib/auth' so route handlers run outside a Next request (user set per call). */
function installFakeAuth(): void {
  const authPath = require.resolve('@/lib/auth');
  const fake = new Module(authPath);
  fake.filename = authPath;
  fake.loaded = true;
  const toPayload = () => currentUser && { userId: currentUser.id, email: currentUser.email, name: currentUser.name, role: currentUser.role };
  fake.exports = { getCurrentUser: async () => toPayload(), requireAuth: async () => toPayload() };
  require.cache[authPath] = fake;
}

async function callRoute(mod: string, method: 'GET' | 'POST', user: DbUser, body: unknown = {}): Promise<{ status: number; body: any }> {
  currentUser = user;
  const req = { json: async () => body, headers: new Headers({ 'content-type': 'application/json' }) };
  const res = await require(mod)[method](req);
  return { status: res.status, body: await res.json().catch(() => null) };
}

async function runGate(tc: TestCase, user: DbUser): Promise<string[]> {
  const failures: string[] = [];

  if (tc.check === 'parser_failure') {
    // Make the Mock parser throw; the meeting must end REJECTED in Postgres with PARSER_FAILED logged
    const proto = require('@/lib/llm/mock').MockLLMProvider.prototype;
    const orig = proto.parseJSON;
    proto.parseJSON = async function (prompt: string, ...rest: unknown[]) {
      if (/Teks rapat \(tersegmentasi/.test(prompt)) throw new Error('parser down (test)');
      return orig.call(this, prompt, ...rest);
    };
    let meetingId: string | undefined;
    try {
      await runPipeline({ title: `[test:b1:db] ${tc.id}`, text: tc.text || '', userId: user.id, userName: user.name });
      failures.push('runPipeline tidak melempar error');
    } catch (err: any) {
      meetingId = err?.meetingId;
      if (err?.code !== 'PARSER_FAILED') failures.push(`error bukan PARSER_FAILED: ${err?.message}`);
    } finally {
      proto.parseJSON = orig;
    }
    if (meetingId) {
      testMeetingIds.push(meetingId);
      const m = await prisma.meeting.findUnique({ where: { id: meetingId } });
      if (m?.status !== 'REJECTED') failures.push(`status meeting ${m?.status} (harap REJECTED)`);
      await new Promise((r) => setTimeout(r, 500));
      const logs = await prisma.auditLog.findMany({ where: { meetingId, type: 'PARSER_FAILED' } });
      if (logs.length !== 1) failures.push(`PARSER_FAILED tercatat ${logs.length}x`);
    } else failures.push('meetingId tidak ada di error');
  }

  if (tc.check === 'pipeline_failure') {
    // Break one DB read inside planCandidates; the meeting must end REJECTED in Postgres
    const delegate = prisma.contact as any;
    const orig = delegate.findMany;
    delegate.findMany = async () => { throw new Error('contact table unavailable (test)'); };
    if (delegate.findMany === orig) failures.push('tidak bisa mengganti prisma.contact.findMany untuk uji');
    let meetingId: string | undefined;
    try {
      await runPipelineWithCandidates({
        title: `[test:b1:db] ${tc.id}`, text: tc.text || '', participants: [], userId: user.id, userName: user.name,
        candidates: toCandidates(tc.candidates || []),
      });
      failures.push('runPipelineWithCandidates tidak melempar error');
    } catch (err: any) {
      meetingId = err?.meetingId;
      if (err?.code !== 'PIPELINE_FAILED') failures.push(`error bukan PIPELINE_FAILED: ${err?.message}`);
    } finally {
      delegate.findMany = orig;
    }
    if (meetingId) {
      testMeetingIds.push(meetingId);
      const m = await prisma.meeting.findUnique({ where: { id: meetingId } });
      if (m?.status !== 'REJECTED') failures.push(`status meeting ${m?.status} (harap REJECTED)`);
      const pending = await prisma.actionCandidate.count({ where: { meetingId, status: 'PENDING' } });
      if (pending > 0) failures.push(`${pending} kandidat masih PENDING`);
      await new Promise((r) => setTimeout(r, 500));
      const logs = await prisma.auditLog.findMany({ where: { meetingId, type: 'PIPELINE_FAILED' } });
      if (logs.length !== 1) failures.push(`PIPELINE_FAILED tercatat ${logs.length}x`);
    } else failures.push('meetingId tidak ada di error');
  }

  if (tc.check === 'clarify_atomic') {
    installFakeAuth();
    const result = await runPipelineWithCandidates({
      title: `[test:b1:db] ${tc.id}`, text: tc.text || '', participants: [], userId: user.id, userName: user.name,
      candidates: toCandidates(tc.candidates || []),
    });
    const meetingId = result.meetingId;
    testMeetingIds.push(meetingId);
    const contactQ = result.clarifierQuestions.find((q) => q.type === 'contact_ambiguity');
    const dateQ = result.clarifierQuestions.find((q) => q.type === 'missing_due_date');
    if (!contactQ || !dateQ) {
      failures.push(`pertanyaan kontak+tanggal tidak lengkap: ${result.clarifierQuestions.map((q) => q.type).join(',')}`);
    } else {
      const snapshot = async () => JSON.stringify(
        (await prisma.actionCandidate.findMany({ where: { meetingId }, orderBy: { candidateId: 'asc' } }))
          .map((c) => [c.owner, c.ownerId, c.recipients, c.dueDate, c.dueTime])
      );
      const before = await snapshot();
      const chosen = contactQ.options?.[0]?.value || '';
      const bad = await callRoute('@/app/api/agent/clarify/route', 'POST', user, {
        meetingId, answers: [{ questionId: contactQ.id, value: chosen }, { questionId: dateQ.id, value: 'nanti saja' }],
      });
      if (bad.status !== 400 || bad.body?.code !== 'DATE_UNPARSEABLE') failures.push(`tanggal tak terbaca: ${bad.status} ${bad.body?.code}`);
      if ((await snapshot()) !== before) failures.push('kandidat berubah walau tanggal ditolak');
      const m1 = await prisma.meeting.findUnique({ where: { id: meetingId } });
      if (m1?.clarifierAnswers) failures.push('clarifierAnswers tersimpan walau ditolak');
      const ok = await callRoute('@/app/api/agent/clarify/route', 'POST', user, {
        meetingId, answers: [{ questionId: contactQ.id, value: chosen }, { questionId: dateQ.id, value: '4 November 2026' }],
      });
      if (ok.status !== 200) failures.push(`jawaban sah: ${ok.status} ${ok.body?.error ?? ''}`);
      const row = await prisma.actionCandidate.findFirst({ where: { meetingId } });
      if (row?.ownerId !== chosen || row?.dueDate !== '2026-11-04') failures.push(`setelah jawaban sah: ownerId=${row?.ownerId}, dueDate=${row?.dueDate}`);
      // Once the plan is rejected, answers may no longer change it
      await callRoute('@/app/api/agent/reject/route', 'POST', user, { meetingId });
      const late = await callRoute('@/app/api/agent/clarify/route', 'POST', user, {
        meetingId, answers: [{ questionId: contactQ.id, value: chosen }, { questionId: dateQ.id, value: '5 November 2026' }],
      });
      if (late.status !== 409 || late.body?.code !== 'MEETING_NOT_EDITABLE') failures.push(`clarify pada meeting REJECTED: ${late.status} ${late.body?.code}`);
      const after = await prisma.actionCandidate.findFirst({ where: { meetingId } });
      if (after?.dueDate !== '2026-11-04') failures.push(`dueDate berubah setelah meeting REJECTED: ${after?.dueDate}`);
    }
  }

  if (tc.check === 'assignee') {
    // Seed links contacts to users: a unique owner, and an ambiguous one picked in the clarifier
    installFakeAuth();
    const result = await runPipelineWithCandidates({
      title: `[test:b1:db] ${tc.id}`, text: tc.text || '', participants: [], userId: user.id, userName: user.name,
      candidates: toCandidates(tc.candidates || []),
    });
    testMeetingIds.push(result.meetingId);
    const hartono = await prisma.contact.findFirst({ where: { name: 'Budi Hartono' } });
    if (!hartono?.userId) failures.push('kontak Budi Hartono tidak terhubung ke user (seed?)');
    const rows = await prisma.actionCandidate.findMany({ where: { meetingId: result.meetingId }, orderBy: { candidateId: 'asc' } });
    const unique = rows.find((r) => r.candidateId === 'cand-01');
    const ambiguous = rows.find((r) => r.candidateId === 'cand-02');
    if (unique?.assigneeId !== hartono?.userId) failures.push(`owner unik: assigneeId ${unique?.assigneeId}`);
    if (ambiguous?.assigneeId) failures.push(`owner ambigu sudah punya assignee ${ambiguous.assigneeId}`);
    const q = result.clarifierQuestions.find((x) => x.type === 'contact_ambiguity' && x.candidateId === 'cand-02');
    if (q && hartono) {
      const res = await callRoute('@/app/api/agent/clarify/route', 'POST', user, {
        meetingId: result.meetingId,
        answers: result.clarifierQuestions.map((x) => ({ questionId: x.id, value: x.type === 'contact_ambiguity' ? hartono.id : '10 November 2026' })),
      });
      if (res.status !== 200) failures.push(`clarify: ${res.status} ${res.body?.error ?? ''}`);
      const after = await prisma.actionCandidate.findFirst({ where: { meetingId: result.meetingId, candidateId: 'cand-02' } });
      if (after?.assigneeId !== hartono.userId) failures.push(`setelah klarifikasi: assigneeId ${after?.assigneeId}`);
    } else failures.push('tidak ada pertanyaan Budi yang mana untuk cand-02');
  }

  if (tc.check === 'grouped_clarify') {
    installFakeAuth();
    const result = await runPipelineWithCandidates({
      title: `[test:b1:db] ${tc.id}`, text: tc.text || '', participants: [], userId: user.id, userName: user.name,
      candidates: toCandidates(tc.candidates || []),
    });
    testMeetingIds.push(result.meetingId);
    const qs = result.clarifierQuestions.filter((q) => q.type === 'contact_ambiguity');
    if (qs.length !== 1) failures.push(`${qs.length} pertanyaan Budi (harap 1)`);
    const q = qs[0];
    if (q && JSON.stringify(q.candidateIds) !== '["cand-01","cand-02"]') failures.push(`candidateIds ${JSON.stringify(q?.candidateIds)}`);
    const stored = ((await prisma.meeting.findUnique({ where: { id: result.meetingId } }))?.clarifierQuestions as any[]) || [];
    if (!stored.some((x) => Array.isArray(x.candidateIds) && x.candidateIds.length === 2)) failures.push('candidateIds tidak tersimpan di Postgres');
    const hartono = await prisma.contact.findFirst({ where: { name: 'Budi Hartono' } });
    if (q && hartono) {
      const conflict = await callRoute('@/app/api/agent/clarify/route', 'POST', user, {
        meetingId: result.meetingId, answers: [{ questionId: q.id, value: hartono.id }, { questionId: q.id, value: q.options?.find((o) => o.value !== hartono.id)?.value }],
      });
      if (conflict.status !== 400 || conflict.body?.code !== 'ANSWER_CONFLICT') failures.push(`dua Budi berbeda: ${conflict.status} ${conflict.body?.code}`);
      const ok = await callRoute('@/app/api/agent/clarify/route', 'POST', user, { meetingId: result.meetingId, answers: [{ questionId: q.id, value: hartono.id }] });
      if (ok.status !== 200) failures.push(`clarify: ${ok.status} ${ok.body?.error ?? ''}`);
      const rows = await prisma.actionCandidate.findMany({ where: { meetingId: result.meetingId } });
      for (const r of rows) {
        if (r.ownerId !== hartono.id) failures.push(`${r.candidateId}: ownerId ${r.ownerId} (harap ${hartono.id})`);
        if (hartono.userId && r.assigneeId !== hartono.userId) failures.push(`${r.candidateId}: assigneeId ${r.assigneeId}`);
      }
    } else failures.push('pertanyaan atau kontak Budi Hartono tidak ada');
  }

  if (tc.check === 'chat_sessions') {
    // AI chat sessions on real Prisma: relation filters (sole member), JSON meta, delete transaction
    installFakeAuth();
    const other = (await prisma.user.findFirst({ where: { role: 'MANAGER' } })) as DbUser | null;
    if (!other) return ['user MANAGER tidak ada (seed?)'];
    const call = async (mod: string, method: string, who: DbUser, body: unknown = {}, id?: string) => {
      currentUser = who;
      const req = { json: async () => body, headers: new Headers({ 'content-type': 'application/json' }) };
      const res = await require(mod)[method](req, { params: Promise.resolve({ id }) });
      const text: string = await res.text();
      let parsed: any = null;
      try { parsed = JSON.parse(text); } catch { parsed = null; }
      return { status: res.status as number, body: parsed, text };
    };
    const AI = '@/app/api/chat/ai/route';
    const LIST = '@/app/api/chat/ai/sessions/route';
    const ONE = '@/app/api/chat/ai/sessions/[id]/route';
    const MSGS = '@/app/api/chat/ai/sessions/[id]/messages/route';

    const chat = await call(AI, 'POST', user, { message: tc.text });
    const events: any[] = chat.text.split('\n').filter((l) => l.startsWith('data: ')).map((l) => JSON.parse(l.slice(6)));
    const channelId: string | undefined = events[0]?.type === 'session' ? events[0].channelId : undefined;
    const plan = events.find((e) => e.type === 'plan')?.plan;
    if (plan?.meetingId) testMeetingIds.push(plan.meetingId);
    try {
      if (!channelId) failures.push(`event pertama ${events[0]?.type} (harap session)`);
      if (!plan?.meetingId) failures.push(`tidak ada event plan: ${events.map((e) => e.type).filter((t) => t !== 'chunk').join(',')}`);
      if (channelId && plan?.meetingId) {
        const m = await prisma.meeting.findUnique({ where: { id: plan.meetingId }, include: { candidates: true } });
        if (m?.status !== 'READY' || plan.status !== 'READY') failures.push(`status meeting ${m?.status}, kartu ${plan.status}`);
        const pending = (m?.candidates || []).filter((c) => c.status === 'PENDING');
        if (plan.planHash !== hashPlan(pending.map((c) => hashCandidate(c)))) failures.push('planHash kartu != hash Review');
        if (!plan.questions?.some((q: any) => q.type === 'contact_ambiguity')) failures.push('kartu tanpa pertanyaan Budi yang mana');
        const stored = await prisma.chatMessage.findFirst({ where: { channelId, isAI: true } });
        if (stored?.meetingId !== plan.meetingId || (stored?.meta as any)?.plans?.[0]?.meetingId !== plan.meetingId) failures.push('kartu tidak tersimpan di ChatMessage.meta/meetingId');

        const list = await call(LIST, 'GET', user);
        const mine = list.body?.sessions?.find((x: any) => x.id === channelId);
        if (mine?.pendingApproval !== true || mine?.lastMeetingId !== plan.meetingId) failures.push(`daftar sesi: ${JSON.stringify(mine)}`);
        if ((await call(LIST, 'GET', other)).body?.sessions?.some((x: any) => x.id === channelId)) failures.push('sesi muncul di daftar user lain');
        const peek = await call(MSGS, 'GET', other, {}, channelId);
        if (peek.status !== 404) failures.push(`user lain baca riwayat -> ${peek.status}`);
        const post = await call(AI, 'POST', other, { message: 'halo', channelId });
        if (post.status !== 404) failures.push(`user lain POST ke sesi -> ${post.status}`);

        await call('@/app/api/agent/reject/route', 'POST', user, { meetingId: plan.meetingId });
        const hist = await call(MSGS, 'GET', user, {}, channelId);
        const card = hist.body?.messages?.find((x: any) => x.plan)?.plan;
        if (card?.status !== 'REJECTED') failures.push(`status kartu setelah ditolak ${card?.status}`);

        const del = await call(ONE, 'DELETE', user, {}, channelId);
        if (del.status !== 200 || del.body?.ok !== true) failures.push(`DELETE -> ${del.status}`);
        if (await prisma.chatChannel.findUnique({ where: { id: channelId } })) failures.push('channel masih ada setelah DELETE');
        if ((await prisma.chatMessage.count({ where: { channelId } })) > 0) failures.push('pesan tertinggal setelah DELETE');
        if (!(await prisma.meeting.findUnique({ where: { id: plan.meetingId } }))) failures.push('meeting ikut terhapus');
        const executions = await prisma.executionRecord.count({ where: { candidate: { meetingId: plan.meetingId } } });
        if (executions > 0) failures.push(`${executions} eksekusi dari chat`);
      }
    } finally {
      if (channelId) await prisma.chatChannel.deleteMany({ where: { id: channelId } });
    }
  }

  if (tc.check === 'reject_routes') {
    installFakeAuth();
    const result = await runPipelineWithCandidates({
      title: `[test:b1:db] ${tc.id}`,
      text: tc.text || '',
      participants: tc.participants || [],
      userId: user.id,
      userName: user.name,
      candidates: toCandidates(tc.candidates || []),
    });
    const meetingId = result.meetingId;
    testMeetingIds.push(meetingId);

    // Pending list on real Prisma (nested relation filter + creator select)
    const pending = await callRoute('@/app/api/tasks/pending/route', 'GET', user);
    const plan = pending.body?.plans?.find((p: any) => p.meetingId === meetingId);
    if (pending.status !== 200 || !plan) failures.push(`pending: status ${pending.status}, rencana ${plan ? 'ada' : 'tidak ada'}`);
    else {
      const ambiguous = plan.items.find((i: any) => i.candidateId === 'cand-01');
      if (!ambiguous?.reasons?.includes('needs_clarification')) failures.push(`cand-01 tanpa needs_clarification: ${ambiguous?.reasons}`);
      if (plan.creatorName !== user.name) failures.push(`creatorName ${plan.creatorName}`);
    }

    const tasks = await callRoute('@/app/api/tasks/route', 'GET', user);
    const t = tasks.body?.tasks?.find((x: any) => x.meetingId === meetingId);
    if (!t?.meeting?.status || !t?.meeting?.createdAt) failures.push('/api/tasks tanpa meeting.status/createdAt');

    const rej = await callRoute('@/app/api/agent/reject/route', 'POST', user, { meetingId, candidateIds: ['cand-01'], reason: 'uji' });
    if (rej.status !== 200 || JSON.stringify(rej.body?.rejected) !== '["cand-01"]') failures.push(`reject: ${rej.status} ${JSON.stringify(rej.body)}`);
    const row = await prisma.actionCandidate.findFirst({ where: { meetingId, candidateId: 'cand-01' } });
    const ap = await callRoute('@/app/api/agent/approve/route', 'POST', user, {
      meetingId, approved: row ? [{ candidateId: 'cand-01', planHash: hashCandidate(row) }] : [], confirmHighImpact: true,
    });
    if (ap.status !== 409 || ap.body?.rejectedCandidate !== true) failures.push(`approve kandidat REJECTED: ${ap.status} ${JSON.stringify(ap.body)}`);
    const executions = await prisma.executionRecord.count({ where: { candidate: { meetingId } } });
    if (executions > 0) failures.push(`${executions} eksekusi setelah reject`);
    const all = await callRoute('@/app/api/agent/reject/route', 'POST', user, { meetingId });
    const m = await prisma.meeting.findUnique({ where: { id: meetingId } });
    if (all.status !== 200 || m?.status !== 'REJECTED') failures.push(`reject semua: ${all.status}, meeting ${m?.status}`);
  }


  if (tc.check === 'hash_mismatch') {
    const shown: HashableCandidate = {
      candidateId: 'cand-01', actionType: 'email', title: 'Kirim laporan', owner: 'Sari Wijaya', ownerId: 'c003',
      dueDate: '2026-11-10', dueTime: null, location: null, recipients: ['sari.wijaya@company.id'],
      isExternal: false, recipientCount: 1,
    };
    const token = createApprovalToken(hashPlan([hashCandidate(shown)]));
    const edited = { ...shown, recipients: [...shown.recipients, 'semua@company.id'], recipientCount: 2 };
    if (!verifyApprovalToken(hashPlan([hashCandidate(shown)]), token)) failures.push('token sah ditolak');
    if (hashCandidate(edited) === hashCandidate(shown)) failures.push('hash tidak berubah setelah penerima diubah');
    if (verifyApprovalToken(hashPlan([hashCandidate(edited)]), token)) failures.push('approval lama diterima untuk rencana yang diubah');
  }

  if (tc.check === 'high_impact') {
    const base = { isExternal: false, recipientCount: 1, recipients: ['sari.wijaya@company.id'] };
    if (isHighImpact(base)) failures.push('1 penerima internal dianggap dampak tinggi');
    if (!isHighImpact({ ...base, isExternal: true })) failures.push('penerima eksternal tidak dianggap dampak tinggi');
    if (!isHighImpact({ ...base, recipientCount: 6 })) failures.push('6 penerima tidak dianggap dampak tinggi');
  }

  if (tc.check === 'permission') {
    const staffToManager = await checkContactPermission('STAFF', 'c001', 'email');
    const staffWhatsapp = await checkContactPermission('STAFF', 'c002', 'whatsapp');
    const managerToExternal = await checkContactPermission('MANAGER', 'e001', 'email');
    if (staffToManager.allowed) failures.push('STAFF boleh menghubungi Budi Santoso (Manager)');
    if (staffWhatsapp.allowed) failures.push('WhatsApp ke Budi Hartono diizinkan padahal tidak ada di allowedTools');
    if (!managerToExternal.allowed) failures.push(`MANAGER ditolak menghubungi e001: ${managerToExternal.reason}`);
  }

  if (tc.check === 'idempotency') {
    const meetingId = `test-b1-${Date.now()}`;
    const before = await checkIdempotency(meetingId, 'cand-01', 'email');
    await storeIdempotencyKey(meetingId, 'cand-01', 'email', 'test-execution');
    const after = await checkIdempotency(meetingId, 'cand-01', 'email');
    await prisma.idempotencyKey.deleteMany({ where: { meetingId } });
    if (before.executed) failures.push('dianggap sudah dieksekusi sebelum ada eksekusi');
    if (!after.executed) failures.push('eksekusi kedua tidak terdeteksi');
  }

  return failures;
}

async function cleanup(): Promise<void> {
  if (testMeetingIds.length === 0) return;
  await new Promise((r) => setTimeout(r, 500));
  await prisma.auditLog.deleteMany({ where: { meetingId: { in: testMeetingIds } } });
  await prisma.idempotencyKey.deleteMany({ where: { meetingId: { in: testMeetingIds } } });
  await prisma.meeting.deleteMany({ where: { id: { in: testMeetingIds } } });
}

function toMarkdown(results: CaseResult[], provider: string): string {
  const passed = results.filter((r) => r.pass).length;
  const lines = [
    `# Hasil test:b1:db`,
    ``,
    `- Waktu: ${new Date().toISOString()}`,
    `- Provider LLM: ${provider}`,
    `- Lulus: **${passed}/${results.length}**`,
    ``,
    `| ID | Kasus | Aturan | Hasil | ms | Catatan |`,
    `|---|---|---|---|---|---|`,
    ...results.map(
      (r) => `| ${r.id} | ${r.name} | ${r.rule} | ${r.pass ? 'PASS' : '**FAIL**'} | ${r.ms} | ${r.failures.join('; ').replace(/\|/g, '/')} |`
    ),
    ``,
  ];
  return lines.join('\n');
}

async function main(): Promise<void> {
  const root = process.cwd();
  const file = JSON.parse(readFileSync(join(root, 'tests', 'db-cases.json'), 'utf8')) as { cases: TestCase[] };
  const only = process.argv.slice(2).filter((a) => /^TC\d+$/i.test(a)).map((a) => a.toUpperCase());
  const cases = only.length > 0 ? file.cases.filter((c) => only.includes(c.id)) : file.cases;

  const user = await prisma.user.findFirst({ where: { role: 'SECRETARY' } });
  if (!user) throw new Error('User SECRETARY tidak ada. Jalankan npm run db:seed dulu.');

  const results: CaseResult[] = [];
  for (const tc of cases) {
    const start = Date.now();
    let failures: string[];
    try {
      failures = tc.kind === 'plan' ? await runPlan(tc, user) : await runGate(tc, user);
    } catch (err) {
      failures = [`error: ${(err as Error).message.split('\n')[0]}`];
    }
    const r = { id: tc.id, name: tc.name, rule: tc.rule, pass: failures.length === 0, failures, ms: Date.now() - start };
    results.push(r);
    console.log(`${r.pass ? 'PASS' : 'FAIL'}  ${r.id}  ${r.name}${r.pass ? '' : `\n      - ${r.failures.join('\n      - ')}`}`);
  }

  await cleanup();

  const provider = getLLMProvider().name;
  writeFileSync(join(root, 'tests', 'db-last-run.md'), toMarkdown(results, provider), 'utf8');

  const passed = results.filter((r) => r.pass).length;
  console.log(`\n${passed}/${results.length} lulus (provider: ${provider}). Ringkasan: tests/db-last-run.md`);
  await prisma.$disconnect();
  process.exit(passed === results.length ? 0 : 1);
}

main().catch(async (err) => {
  console.error(err);
  await cleanup().catch(() => {});
  await prisma.$disconnect();
  process.exit(1);
});
