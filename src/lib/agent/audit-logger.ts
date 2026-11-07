import { promises as fs } from 'fs';
import { join } from 'path';
import { prisma } from '@/lib/db';

const AUDIT_DIR = join(process.cwd(), 'audit-logs');

/**
 * Trace of one meeting, in order:
 * request  INPUT_RECEIVED / CLI_PLAN_REQUESTED -> guards -> PARSER_CALLED (| PARSER_FAILED / PIPELINE_FAILED: meeting REJECTED)
 * plan     SCHEMA_VALIDATED -> EVIDENCE_CHECKED / EVIDENCE_REJECTED -> CLARIFIER_ASKED -> RULE_WARNING
 *          -> VALIDATOR_CALLED -> NOTULEN_GENERATED -> CONFIRMATION_SHOWN (plan hash shown to the user)
 * approval CLARIFY_ANSWERED -> APPROVAL_GIVEN (planHash) | APPROVAL_REJECTED
 * execute  EXECUTION_REQUESTED -> IDEMPOTENCY_CHECK -> EXECUTION_SUCCESS | EXECUTION_FAILED
 * undo     UNDO_TRIGGERED -> EXECUTION_UNDONE | UNDO_WINDOW_EXPIRED
 */
export type AuditEventType =
  | 'INPUT_RECEIVED'
  | 'CLI_PLAN_REQUESTED'
  | 'CONSENT_LOGGED'
  | 'INJECTION_DETECTED'
  | 'PII_REDACTED'
  | 'PARSER_CALLED'
  | 'PARSER_FAILED'
  | 'PIPELINE_FAILED' // any later stage failed after the meeting existed; meeting REJECTED
  | 'SCHEMA_VALIDATED'
  | 'EVIDENCE_CHECKED'
  | 'EVIDENCE_REJECTED'
  | 'CLARIFIER_ASKED'
  | 'CLARIFY_ANSWERED'
  | 'CONFIRMATION_SHOWN'
  | 'RULE_WARNING'
  | 'VALIDATOR_CALLED'
  | 'NOTULEN_GENERATED'
  | 'PLAN_APPROVED' // legacy name, kept so old logs still parse; new code logs APPROVAL_GIVEN
  | 'APPROVAL_GIVEN'
  | 'EXECUTION_REQUESTED'
  | 'EXECUTION_SUCCESS'
  | 'EXECUTION_UNDONE'
  | 'EXECUTION_FAILED'
  | 'UNDO_TRIGGERED'
  | 'UNDO_WINDOW_EXPIRED'
  | 'IDEMPOTENCY_CHECK'
  | 'AI_TOOL_CALL_REQUESTED'
  | 'AI_TOOL_CALL_EXECUTED'
  | 'AI_TOOL_CALL_DENIED'
  | 'AI_PLAN_PROPOSED'
  | 'INJECTION_ACTION_BLOCKED'
  | 'APPROVAL_REJECTED';

export interface AuditEvent {
  type: AuditEventType;
  meetingId?: string;
  userId?: string;
  payload: Record<string, unknown>;
  timestamp: string;
}

// Writes still in flight; short-lived processes (CLI) await them via flushAuditLogs()
const pending = new Set<Promise<unknown>>();

function track(p: Promise<unknown>): void {
  pending.add(p);
  p.finally(() => pending.delete(p));
}

// Dual write: JSONL file + DB table
export async function logAudit(event: Omit<AuditEvent, 'timestamp'>): Promise<void> {
  const fullEvent: AuditEvent = {
    ...event,
    timestamp: new Date().toISOString(),
  };

  // Write to DB (non-blocking)
  track(
    prisma.auditLog
      .create({
        data: {
          meetingId: event.meetingId,
          userId: event.userId,
          type: event.type,
          payload: fullEvent as any,
        },
      })
      .catch((err) => console.error('[AuditLogger] DB write failed:', err))
  );

  // Write to JSONL file (non-blocking)
  track(writeJSONL(fullEvent).catch((err) => console.error('[AuditLogger] JSONL write failed:', err)));
}

/**
 * Wait for every pending audit write. Call before a script exits.
 */
export async function flushAuditLogs(): Promise<void> {
  while (pending.size > 0) {
    await Promise.allSettled([...pending]);
  }
}

async function writeJSONL(event: AuditEvent): Promise<void> {
  const date = event.timestamp.split('T')[0];
  const filename = `audit_${date}.jsonl`;
  const filepath = join(AUDIT_DIR, filename);

  try {
    await fs.mkdir(AUDIT_DIR, { recursive: true });
    await fs.appendFile(filepath, JSON.stringify(event) + '\n', 'utf8');
  } catch (err) {
    console.error('[AuditLogger] Failed to write JSONL:', err);
  }
}

/**
 * Read events for one meeting from the JSONL files (works without a database).
 * Oldest first.
 */
export async function readAuditJSONL(meetingId: string, dir: string = AUDIT_DIR): Promise<AuditEvent[]> {
  let files: string[];
  try {
    files = (await fs.readdir(dir)).filter((f) => /^audit_.*\.jsonl$/.test(f)).sort();
  } catch {
    return [];
  }

  const events: AuditEvent[] = [];
  for (const file of files) {
    const content = await fs.readFile(join(dir, file), 'utf8');
    for (const line of content.split('\n')) {
      if (!line.trim()) continue;
      try {
        const event = JSON.parse(line) as AuditEvent;
        if (event.meetingId === meetingId) events.push(event);
      } catch {
        // skip a corrupt line, keep the rest of the trail
      }
    }
  }
  return events.sort((a, b) => a.timestamp.localeCompare(b.timestamp));
}

export async function getAuditLogs(meetingId?: string, limit = 50): Promise<AuditEvent[]> {
  const logs = await prisma.auditLog.findMany({
    where: meetingId ? { meetingId } : undefined,
    orderBy: { createdAt: 'desc' },
    take: limit,
  });
  return logs.map((l) => l.payload as unknown as AuditEvent);
}
