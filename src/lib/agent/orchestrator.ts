import { prisma } from '@/lib/db';
import { detectPII } from './input-guard/redaction-gate';
import { detectInjection } from './input-guard/injection-detector';
import { logConsent, getRetentionDate } from './input-guard/consent-logger';
import { parseMeetingText } from './parser';
import { validateCandidates } from './output-guard/schema-validator';
import { applyEvidenceGates } from './output-guard/evidence-validator';
import { normalizeForMatch, quoteIn } from './output-guard/segmenter';
import { clarify } from './clarifier';
import { checkRules, applyRuleSuggestions } from './rule-checker';
import { validatePlan } from './validator';
import { generateNotulen } from './notulen-generator';
import { logAudit } from './audit-logger';
import { resolveRecipients, serializeRecipients } from '@/lib/contacts/resolver';
import { getLLMProvider } from '@/lib/llm';
import { matchContactsByName } from '@/lib/contacts/match';
import type { PipelineResult, ActionCandidate, InjectionResult, RedactionResult } from './types';

export interface OrchestratorInput {
  title?: string;
  text: string;
  participants?: string[];
  userId: string;
  userName: string;
}

export interface GuardedText {
  cleanedText: string;
  injectionResult: InjectionResult;
  redactionResult: RedactionResult;
}

/**
 * Layer 1 (input guard): PII redaction + prompt-injection quarantine.
 * Every text that reaches an LLM or becomes a plan goes through here first.
 */
export function guardInput(text: string): GuardedText {
  const redactionResult = detectPII(text);
  const injectionResult = detectInjection(redactionResult.cleanedText);
  return { cleanedText: injectionResult.cleanedText, injectionResult, redactionResult };
}

/**
 * Audit the input-guard findings against the meeting they belong to.
 */
export async function logInputGuard(meetingId: string, userId: string, guarded: GuardedText): Promise<void> {
  const { redactionResult, injectionResult } = guarded;
  if (redactionResult.detected) {
    await logAudit({
      type: 'PII_REDACTED',
      meetingId,
      userId,
      payload: { count: redactionResult.items.length, types: redactionResult.items.map((i) => i.type) },
    });
  }
  if (injectionResult.detected) {
    await logAudit({
      type: 'INJECTION_DETECTED',
      meetingId,
      userId,
      payload: {
        segments: injectionResult.quarantinedSegments.length,
        patterns: injectionResult.quarantinedSegments.map((s) => s.pattern),
        quarantinedSegments: injectionResult.quarantinedSegments,
      },
    });
  }
}

/**
 * The parser LLM failed (unreachable, bad JSON, schema mismatch). The meeting is
 * already marked REJECTED and PARSER_FAILED is logged; `reason` stays server-side.
 */
export class ParserFailedError extends Error {
  readonly code = 'PARSER_FAILED';
  constructor(public readonly meetingId: string, public readonly reason: string) {
    super(`Parser gagal: ${reason}`);
    this.name = 'ParserFailedError';
  }
}

/**
 * Any other failure after the meeting record exists (consent/audit, gates, clarifier,
 * DB writes). The meeting is already REJECTED, half-saved candidates too, and
 * PIPELINE_FAILED is logged; `reason` stays server-side.
 */
export class PipelineFailedError extends Error {
  readonly code = 'PIPELINE_FAILED';
  constructor(public readonly meetingId: string, public readonly reason: string, public readonly stage: string) {
    super(`Pipeline gagal (${stage}): ${reason}`);
    this.name = 'PipelineFailedError';
  }
}

// Provider the parser used (cached by getLLMProvider; no second health check)
function providerName(): string {
  try {
    return getLLMProvider().name;
  } catch {
    return 'unknown';
  }
}

const errorReason = (err: unknown) => (err instanceof Error ? err.message : String(err)).slice(0, 300);

/**
 * Fail closed: the meeting must never stay PROCESSING and nothing half-planned may be
 * approvable. Best effort: if the DB itself is down the original error still surfaces.
 */
async function rejectMeeting(meetingId: string): Promise<void> {
  try {
    await prisma.actionCandidate.updateMany({ where: { meetingId, status: 'PENDING' }, data: { status: 'REJECTED' } });
    await prisma.meeting.update({ where: { id: meetingId }, data: { status: 'REJECTED' } });
  } catch (cleanupErr) {
    console.error('[Orchestrator] Could not mark meeting REJECTED:', cleanupErr);
  }
}

/**
 * Run one stage of a pipeline whose meeting already exists; any error → REJECTED + PIPELINE_FAILED.
 * Exported for the AI chat path (tool-registry proposeActions).
 */
export async function guardStage<T>(meetingId: string, userId: string, stage: string, fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (err) {
    if (err instanceof ParserFailedError || err instanceof PipelineFailedError) throw err;
    const reason = errorReason(err);
    await rejectMeeting(meetingId);
    try {
      await logAudit({ type: 'PIPELINE_FAILED', meetingId, userId, payload: { reason, stage } });
    } catch {
      // audit is best effort here; the meeting is already closed
    }
    throw new PipelineFailedError(meetingId, reason, stage);
  }
}

export async function runPipeline(input: OrchestratorInput): Promise<PipelineResult> {
  const { meetingId, title, guarded } = await openMeeting(input);

  // ============ LAYER 2: PARSER (LLM) ============
  const parserOutput = await guardStage(meetingId, input.userId, 'parser', async () => {
    await logAudit({ type: 'PARSER_CALLED', meetingId, userId: input.userId, payload: {} });
    try {
      return await parseMeetingText(guarded.cleanedText);
    } catch (err) {
      const reason = errorReason(err);
      await rejectMeeting(meetingId);
      await logAudit({
        type: 'PARSER_FAILED',
        meetingId,
        userId: input.userId,
        payload: { reason, provider: providerName() },
      });
      throw new ParserFailedError(meetingId, reason);
    }
  });

  return guardStage(meetingId, input.userId, 'plan', () =>
    planCandidates({
      meetingId,
      title,
      userId: input.userId,
      userName: input.userName,
      participants: input.participants || [],
      candidates: parserOutput.candidates,
      guarded,
    })
  );
}

/**
 * Chitragupta path: the agent reads the meeting text and proposes
 * candidates itself; the app skips its own parser LLM and runs the same
 * deterministic gates (layers 1, 3–7) on what was proposed.
 */
export async function runPipelineWithCandidates(
  input: OrchestratorInput & { candidates: ActionCandidate[] }
): Promise<PipelineResult> {
  const { meetingId, title, guarded } = await openMeeting(input);

  return guardStage(meetingId, input.userId, 'plan', async () => {
    await logAudit({
      type: 'PARSER_CALLED',
      meetingId,
      userId: input.userId,
      payload: { source: 'external', candidates: input.candidates.length },
    });
    return planCandidates({
      meetingId,
      title,
      userId: input.userId,
      userName: input.userName,
      participants: input.participants || [],
      candidates: input.candidates,
      guarded,
    });
  });
}

/**
 * Layer 1 + meeting record: input guard, consent, and the first audit events.
 */
async function openMeeting(input: OrchestratorInput): Promise<{ meetingId: string; title: string; guarded: GuardedText }> {
  const { text, userId, userName } = input;
  const title = input.title || `Meeting ${new Date().toLocaleDateString('id-ID')}`;

  // ============ LAYER 1: INPUT GUARD ============
  const guarded = guardInput(text);

  // Consent logger (assume consent given for demo)
  // Create meeting record first
  const meeting = await prisma.meeting.create({
    data: {
      title,
      // Store the guarded text (PII redacted, injections quarantined), never the raw input
      rawText: guarded.cleanedText,
      status: 'PROCESSING',
      creatorId: userId,
      participants: input.participants || [],
      retentionUntil: getRetentionDate(),
    },
  });

  // From here on the meeting exists, so a failure must close it
  await guardStage(meeting.id, userId, 'input', async () => {
    await logConsent(
      meeting.id,
      {
        participantName: userName,
        consentGiven: true,
        consentTimestamp: new Date().toISOString(),
        retentionUntil: getRetentionDate().toISOString(),
      },
      userId
    );

    await logAudit({
      type: 'INPUT_RECEIVED',
      meetingId: meeting.id,
      userId,
      payload: { title, textLength: text.length, participantsCount: input.participants?.length || 0 },
    });
    await logInputGuard(meeting.id, userId, guarded);
  });

  return { meetingId: meeting.id, title, guarded };
}

export interface PlanInput {
  meetingId: string;
  title: string;
  userId: string;
  userName: string;
  participants: string[];
  candidates: ActionCandidate[];
  guarded: GuardedText;
  // Zone of the person creating the plan (WIB/WITA/WIT); counted when deciding to ask the reference zone
  creatorTimezone?: string;
}

/**
 * Layers 3–7: turn proposed candidates into a plan awaiting approval.
 * Shared by the meeting form (parser candidates) and AI chat (propose_actions),
 * so both paths get the same clarifier, rule checker, validator and audit trail.
 * Nothing here executes an action — candidates are stored as PENDING.
 */
export async function planCandidates(input: PlanInput): Promise<PipelineResult> {
  const { meetingId, title, userId, userName, participants, guarded } = input;
  const cleanedText = guarded.cleanedText;
  let candidates = input.candidates;

  // ============ LAYER 3: OUTPUT GUARD ============
  // Step 3a: Schema validation
  const schemaResult = validateCandidates(candidates);
  if (!schemaResult.valid) {
    // Filter out invalid candidates
    candidates = candidates.filter((c) => {
      const errors = schemaResult.errors.filter((e) => e.candidateId === c.id);
      return errors.length === 0;
    });
  }
  await logAudit({
    type: 'SCHEMA_VALIDATED',
    meetingId,
    userId,
    payload: { total: input.candidates.length, valid: candidates.length, errors: schemaResult.errors.length },
  });

  // Step 3b: Drop candidates that come from a quarantined (embedded-instruction) segment.
  // Runs before the evidence gates so the reason is "injection", not evidence_not_found.
  const quarantined = guarded.injectionResult.quarantinedSegments;
  if (quarantined.length > 0) {
    const blocked = candidates.filter((c) => fromQuarantine(c, quarantined, cleanedText));
    candidates = candidates.filter((c) => !blocked.includes(c));
    // Logged even when blocked is empty: the quarantined segments never reached the
    // LLM, so no action could be planned from them (that is the block)
    await logAudit({
      type: 'INJECTION_ACTION_BLOCKED',
      meetingId,
      userId,
      payload: {
        reason: 'injection_quarantined_segment',
        quarantinedSegmentIds: quarantined.map((q) => q.segmentId),
        blocked: blocked.map((c) => ({
          id: c.id,
          title: c.title,
          evidenceQuote: c.evidenceQuote,
          sourceSegmentId: c.sourceSegmentId,
        })),
      },
    });
  }

  // Step 3c: Evidence validator (5 gates). Fatal gates drop the candidate from the plan.
  const contacts = await prisma.contact.findMany();
  const evidence = applyEvidenceGates(candidates, cleanedText, contacts);
  const evidenceIssues = evidence.issues;
  candidates = evidence.accepted;
  await logAudit({
    type: 'EVIDENCE_CHECKED',
    meetingId,
    userId,
    payload: {
      issues: evidenceIssues.length,
      gates: evidenceIssues.map((e) => e.gate),
      rejected: evidence.rejected,
    },
  });
  if (evidence.rejected.length > 0) {
    await logAudit({ type: 'EVIDENCE_REJECTED', meetingId, userId, payload: { rejected: evidence.rejected } });
  }

  // Step 3d: Only firm commitments become actions; suggestions/vague/questions → notulen open_items
  const openItems = candidates.filter((c) => c.commitmentStatus !== 'accepted');
  candidates = candidates.filter((c) => c.commitmentStatus === 'accepted');

  // ============ LAYER 4: CLARIFIER ============
  const clarifierQuestions = await clarify(candidates, cleanedText, participants, input.creatorTimezone);
  if (clarifierQuestions.length > 0) {
    await logAudit({
      type: 'CLARIFIER_ASKED',
      meetingId,
      userId,
      payload: { questions: clarifierQuestions },
    });
  }

  // ============ LAYER 5: RULE CHECKER ============
  const ruleWarnings = await checkRules(candidates, { contacts, participants, creatorTimezone: input.creatorTimezone });
  // Friday-prayer suggestions are applied to the plan itself (marked applied in ruleWarnings)
  candidates = applyRuleSuggestions(candidates, ruleWarnings);
  if (ruleWarnings.length > 0) {
    await logAudit({
      type: 'RULE_WARNING',
      meetingId,
      userId,
      payload: { warnings: ruleWarnings },
    });
  }

  // ============ LAYER 6: VALIDATOR (LLM kedua) ============
  await logAudit({ type: 'VALIDATOR_CALLED', meetingId, userId, payload: {} });
  const validatorResult = await validatePlan(candidates, cleanedText);

  // ============ LAYER 7: NOTULEN GENERATOR ============
  const notulen = generateNotulen(
    title,
    cleanedText,
    participants.length > 0 ? participants : [userName],
    candidates,
    openItems
  );
  await logAudit({
    type: 'NOTULEN_GENERATED',
    meetingId,
    userId,
    payload: { hash: notulen.hash, actionCount: candidates.length, openItemCount: openItems.length },
  });

  // ============ PERSIST TO DB ============
  // Resolve recipients from contacts for each candidate and save to DB
  for (const c of candidates) {
    // Resolve recipients from Contact table
    const resolvedRecipients = await resolveRecipients(c, participants);
    const recipientsStr = serializeRecipients(resolvedRecipients);
    const ownerId = resolvedRecipients.length === 1 ? resolvedRecipients[0].contactId : null;
    // Owner name maps to exactly one contact with an app account → that user sees it under Tugas.
    // Ambiguous owners ("Pak Budi") get no assignee until the clarifier answer picks one.
    const ownerMatches = matchContactsByName(contacts, c.owner);
    const assigneeId = ownerMatches.length === 1 ? ownerMatches[0].userId ?? null : null;

    await prisma.actionCandidate.create({
      data: {
        meetingId,
        candidateId: c.id,
        title: c.title,
        owner: c.owner,
        ownerId,
        assigneeId,
        dueDate: c.dueDate,
        dueTime: c.dueTime,
        location: c.location,
        commitmentStatus: c.commitmentStatus.toUpperCase() as any,
        evidenceQuote: c.evidenceQuote,
        sourceSegmentId: c.sourceSegmentId,
        actionType: c.actionType.toUpperCase() as any,
        isExternal: c.isExternal || resolvedRecipients.some((r) => r.isExternal),
        recipients: recipientsStr,
        recipientCount: resolvedRecipients.length,
        status: 'PENDING',
        ruleWarnings: ruleWarnings.filter((w) => w.candidateId === c.id) as any,
        validatorResult: {
          inMatches: validatorResult.matches.includes(c.id),
          inMismatches: validatorResult.mismatches.includes(c.id),
          warnings: validatorResult.warnings,
          evidenceIssues: evidenceIssues.filter((e) => e.candidateId === c.id),
        } as any,
      },
    });
  }

  // Update meeting status — save clarifier questions to DB
  await prisma.meeting.update({
    where: { id: meetingId },
    data: {
      status: 'READY',
      notulen: notulen as any,
      clarifierQuestions: clarifierQuestions as any,
    },
  });

  // ============ RETURN RESULT ============
  return {
    meetingId,
    notulen,
    candidates,
    ruleWarnings,
    evidenceIssues,
    validatorResult,
    injectionResult: guarded.injectionResult,
    redactionResult: guarded.redactionResult,
    clarifierQuestions,
    rejectedCandidates: evidence.rejected,
    openItems,
  };
}

/**
 * True when a candidate comes from a quarantined segment: it cites that segment id,
 * its quote carries the quarantine marker, or its quote matches the quarantined
 * (original) text while not appearing in the cleaned text.
 */
function fromQuarantine(
  c: ActionCandidate,
  quarantined: InjectionResult['quarantinedSegments'],
  cleanedText: string
): boolean {
  if (quarantined.some((q) => q.segmentId === c.sourceSegmentId)) return true;
  if ((c.evidenceQuote || '').includes('[QUARANTINED]')) return true;
  const quote = normalizeForMatch(c.evidenceQuote || '');
  if (quote.length < 10) return false;
  return quarantined.some((q) => quoteIn(c.evidenceQuote, q.text)) && !quoteIn(c.evidenceQuote, cleanedText);
}
