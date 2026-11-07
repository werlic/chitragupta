/**
 * Shared helpers for B1 test handlers. All app modules are required lazily
 * (after installEnv) so src/lib/db.ts binds to the Prisma stub.
 */
import { readFileSync } from 'fs';
import { join } from 'path';
import { installEnv, callRoute, USERS, type FakeUser } from './env';

export const env = () => installEnv();
const req = (id: string) => require(id);

export const app = {
  orchestrator: () => req('@/lib/agent/orchestrator'),
  clarifier: () => req('@/lib/agent/clarifier'),
  rules: () => req('@/lib/agent/rule-checker'),
  evidence: () => req('@/lib/agent/output-guard/evidence-validator'),
  injection: () => req('@/lib/agent/input-guard/injection-detector'),
  redaction: () => req('@/lib/agent/input-guard/redaction-gate'),
  notulen: () => req('@/lib/agent/notulen-generator'),
  audit: () => req('@/lib/agent/audit-logger'),
  toolRegistry: () => req('@/lib/agent/tool-registry'),
  planHash: () => req('@/lib/agent/execution/plan-hash'),
  gate: () => req('@/lib/agent/execution/gate'),
  idempotency: () => req('@/lib/agent/execution/idempotency'),
  undoWindow: () => req('@/lib/agent/execution/undo-window'),
  permission: () => req('@/lib/agent/execution/permission-gate'),
  toolMock: () => req('@/lib/agent/tool-mock'),
  parser: () => req('@/lib/agent/parser'),
  contacts: () => req('@/lib/contacts/resolver'),
  llm: () => req('@/lib/llm'),
  crypto: () => req('@/lib/utils/crypto'),
};

export const APPROVE_ROUTE = '@/app/api/agent/approve/route';
export const UNDO_ROUTE = '@/app/api/agent/undo/route';

export function chatFile(name: string): string {
  return readFileSync(join(process.cwd(), 'data', 'datapack', 'chats', name), 'utf8');
}

export function participantsFromChat(text: string): string[] {
  const names = new Set<string>();
  for (const m of text.matchAll(/^\[[^\]]+\]\s*([^:]+):/gm)) names.add(m[1].trim());
  return [...names];
}

export function cand(over: Record<string, unknown> = {}): any {
  return {
    id: 'cand-01',
    title: 'Tugas uji',
    owner: 'Sari Wijaya',
    commitmentStatus: 'accepted',
    evidenceQuote: 'tugas uji',
    sourceSegmentId: 'seg-01',
    actionType: 'task',
    recipients: [],
    isExternal: false,
    recipientCount: 0,
    ...over,
  };
}

/** Let fire-and-forget audit writes settle. */
export async function settle(): Promise<void> {
  const audit = app.audit();
  if (typeof audit.flushAuditLogs === 'function') {
    try { await audit.flushAuditLogs(); } catch { /* ignore */ }
  }
  await new Promise((r) => setImmediate(r));
  await new Promise((r) => setImmediate(r));
}

const TZ: Record<string, string> = { 'u-secretary': 'WIB', 'u-manager': 'WIB', 'u-director': 'WIT', 'u-staff': 'WITA' };

export function authUser(u: FakeUser) {
  return { userId: u.userId, name: u.name, role: u.role, timezone: TZ[u.userId] || 'WIB', location: null, department: null };
}

/**
 * Mirror of /api/chat/ai: guard the user message, let the (mock) LLM call tools
 * on the cleaned text, and turn tool calls into plans via proposeFromToolCalls.
 */
export async function chatFlow(message: string, user: FakeUser = USERS.secretary) {
  const e = env();
  e.setUser(user);
  const guarded = app.orchestrator().guardInput(message);
  const llm = await app.llm().getLLMProviderAsync();
  const tools = app.toolRegistry().getToolDefinitionsForLLM();
  const res = await llm.chatWithTools([{ role: 'user', content: guarded.cleanedText }], tools, { temperature: 0.2 });
  const toolCalls = res.toolCalls || [];
  const results = toolCalls.length ? await app.toolRegistry().proposeFromToolCalls(toolCalls, authUser(user), guarded) : [];
  await settle();
  const meetingIds: string[] = results.map((r: any) => r?.data?.meetingId).filter(Boolean);
  return { guarded, toolCalls, results, meetingIds, meetingId: meetingIds[0] as string | undefined, provider: llm.name };
}

/** planCandidates on hand-built candidates (bypasses the LLM parser). */
export async function planDirect(cands: any[], text: string, participants: string[] = [], user: FakeUser = USERS.secretary) {
  const e = env();
  e.setUser(user);
  const orch = app.orchestrator();
  const guarded = orch.guardInput(text);
  const meeting = await e.db.meeting.create({
    data: { title: 'Rapat uji', rawText: guarded.cleanedText, status: 'PROCESSING', creatorId: user.userId, participants },
  });
  const result = await orch.planCandidates({
    meetingId: meeting.id,
    title: 'Rapat uji',
    userId: user.userId,
    userName: user.name,
    participants,
    candidates: cands,
    guarded,
  });
  await settle();
  return { meetingId: meeting.id as string, result };
}

export async function runPipeline(text: string, participants: string[] = [], user: FakeUser = USERS.secretary) {
  const e = env();
  e.setUser(user);
  const result = await app.orchestrator().runPipeline({ title: 'Rapat uji', text, participants, userId: user.userId, userName: user.name });
  await settle();
  return result;
}

export function dbCandidates(meetingId?: string): any[] {
  return env().db.actionCandidate.rows.filter((r: any) => !meetingId || r.meetingId === meetingId);
}

export function approvalList(meetingId: string): Array<{ candidateId: string; planHash: string }> {
  const { hashCandidate } = app.planHash();
  return dbCandidates(meetingId).map((c) => ({ candidateId: c.candidateId, planHash: hashCandidate(c) }));
}

export async function approve(body: Record<string, unknown>, user: FakeUser = USERS.secretary) {
  env().setUser(user);
  const res = await callRoute(APPROVE_ROUTE, body);
  await settle();
  return res;
}

export async function undo(body: Record<string, unknown>, user: FakeUser = USERS.secretary) {
  env().setUser(user);
  const res = await callRoute(UNDO_ROUTE, body);
  await settle();
  return res;
}

export function auditTypes(meetingId?: string): string[] {
  return env().db.auditLog.rows
    .filter((r: any) => !meetingId || r.meetingId === meetingId || r.payload?.meetingId === meetingId)
    .map((r: any) => r.type ?? r.payload?.type);
}

/** Execution side effects that must never happen without an approval. */
export function executionTrace() {
  const db = env().db;
  return {
    executions: db.executionRecord.rows.length,
    idempotencyKeys: db.idempotencyKey.rows.filter((k: any) => k.executionId).length,
    executedCandidates: db.actionCandidate.rows.filter((c: any) => c.status === 'EXECUTED').length,
    executedMeetings: db.meeting.rows.filter((m: any) => m.status === 'EXECUTED').length,
    successAudits: db.auditLog.rows.filter((a: any) => a.type === 'EXECUTION_SUCCESS').length,
  };
}

export function describeTrace(t: ReturnType<typeof executionTrace>): string {
  return Object.entries(t).filter(([, v]) => v > 0).map(([k, v]) => `${k}=${v}`).join(', ');
}

/** Collect every {gate, candidateId} object anywhere in a result (tolerant to refactors). */
export function collectGates(obj: unknown): Array<{ gate: string; candidateId: string; severity?: string }> {
  const out: Array<{ gate: string; candidateId: string; severity?: string }> = [];
  const seen = new Set<unknown>();
  const walk = (x: any) => {
    if (!x || typeof x !== 'object' || seen.has(x)) return;
    seen.add(x);
    if (typeof x.gate === 'string' && typeof x.candidateId === 'string') out.push({ gate: x.gate, candidateId: x.candidateId, severity: x.severity });
    for (const v of Array.isArray(x) ? x : Object.values(x)) walk(v);
  };
  walk(obj);
  return out;
}

/** open_items under any key name variant (openItems / open_items), anywhere in the result. */
export function collectOpenItems(obj: unknown): any[] {
  const out: any[] = [];
  const seen = new Set<unknown>();
  const walk = (x: any) => {
    if (!x || typeof x !== 'object' || seen.has(x)) return;
    seen.add(x);
    for (const [k, v] of Object.entries(x)) {
      if (/^open_?items$/i.test(k) && Array.isArray(v)) out.push(...v);
      else walk(v);
    }
  };
  walk(obj);
  return out;
}

export { USERS };
