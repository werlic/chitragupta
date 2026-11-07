import { z } from 'zod';

// ============ ACTION CANDIDATE ============

export const ActionTypeSchema = z.enum(['email', 'calendar', 'task', 'whatsapp']);
export const CommitmentStatusSchema = z.enum(['accepted', 'suggestion', 'vague', 'question']);

// Parser LLMs (esp. local models) often write `null` for "not mentioned" instead of
// omitting the key; a plain `.optional()` rejects that, so normalize null to undefined.
const optionalString = () => z.string().nullish().transform((v) => v ?? undefined);

export const ActionCandidateSchema = z.object({
  id: z.string(),
  title: z.string(),
  owner: z.string(),
  dueDate: optionalString(),
  dueTime: optionalString(),
  location: optionalString(),
  commitmentStatus: CommitmentStatusSchema,
  evidenceQuote: z.string().max(200),
  sourceSegmentId: z.string(),
  actionType: ActionTypeSchema,
  recipients: z.array(z.string()),
  isExternal: z.boolean(),
  recipientCount: z.number(),
});

export type ActionCandidate = z.infer<typeof ActionCandidateSchema>;

export const ParserOutputSchema = z.object({
  candidates: z.array(ActionCandidateSchema),
});

export type ParserOutput = z.infer<typeof ParserOutputSchema>;

// ============ VALIDATOR OUTPUT ============

export const ValidatorResultSchema = z.object({
  matches: z.array(z.string()),
  mismatches: z.array(z.string()),
  warnings: z.array(z.string()),
});

export type ValidatorResult = z.infer<typeof ValidatorResultSchema>;

// ============ RULE WARNING ============

export const RuleWarningSchema = z.object({
  type: z.enum(['holiday', 'friday_prayer', 'outside_work_hours', 'timezone_mismatch', 'weekend']),
  candidateId: z.string(),
  message: z.string(),
  suggestedDate: z.string().optional(),
  suggestedTime: z.string().optional(),
  // true → the agent already put suggestedTime into the plan ("diusulkan agent")
  applied: z.boolean().optional(),
});

export type RuleWarning = z.infer<typeof RuleWarningSchema>;

// ============ EVIDENCE VALIDATOR ============

export const EvidenceIssueSchema = z.object({
  gate: z.enum(['evidence_not_found', 'source_segment_mismatch', 'owner_unknown', 'deadline_invalid', 'duplicate']),
  candidateId: z.string(),
  message: z.string(),
  // fatal → candidate is rejected from the plan; warning → kept, shown to the reviewer
  severity: z.enum(['fatal', 'warning']).default('warning'),
});

export type EvidenceIssue = z.infer<typeof EvidenceIssueSchema>;

export const RejectedCandidateSchema = z.object({
  id: z.string(),
  title: z.string(),
  owner: z.string(),
  evidenceQuote: z.string(),
  reasons: z.array(EvidenceIssueSchema.shape.gate),
  messages: z.array(z.string()),
});

export type RejectedCandidate = z.infer<typeof RejectedCandidateSchema>;

// ============ INJECTION DETECTION ============

export const InjectionResultSchema = z.object({
  detected: z.boolean(),
  quarantinedSegments: z.array(z.object({
    segmentId: z.string(),
    text: z.string(),
    pattern: z.string(),
  })),
  cleanedText: z.string(),
});

export type InjectionResult = z.infer<typeof InjectionResultSchema>;

// ============ REDACTION ============

export const PIITypeSchema = z.enum(['nik', 'phone', 'email', 'address', 'credit_card']);

export const RedactionResultSchema = z.object({
  detected: z.boolean(),
  items: z.array(z.object({
    type: PIITypeSchema,
    original: z.string(),
    redacted: z.string(),
    position: z.number(),
  })),
  cleanedText: z.string(),
});

export type RedactionResult = z.infer<typeof RedactionResultSchema>;

// ============ NOTULEN ============

export const NotulenSchema = z.object({
  judul: z.string(),
  tanggal: z.string(),
  peserta: z.array(z.string()),
  agenda: z.array(z.string()),
  pembahasan: z.string(),
  keputusan: z.array(z.string()),
  actionItems: z.array(z.object({
    id: z.string(),
    title: z.string(),
    owner: z.string(),
    dueDate: z.string().optional(),
  })),
  // Suggestions / vague / questions: recorded, never turned into actions
  open_items: z.array(z.object({
    id: z.string(),
    title: z.string(),
    owner: z.string().optional(),
    status: z.enum(['suggestion', 'vague', 'question']),
    evidenceQuote: z.string(),
  })).default([]),
  hash: z.string(),
});

export type Notulen = z.infer<typeof NotulenSchema>;

// ============ CLARIFIER QUESTION (structured) ============

export const ClarifierQuestionSchema = z.object({
  id: z.string(),
  type: z.enum(['contact_ambiguity', 'timezone_reference', 'vague_commitment', 'missing_due_date']),
  candidateId: z.string(),
  question: z.string(),
  options: z.array(z.object({
    value: z.string(),
    label: z.string(),
    // contact_ambiguity only: Contact details so the reviewer can tell the matches apart.
    // Optional, so questions stored before these fields existed still parse.
    role: z.string().nullable().optional(),
    department: z.string().nullable().optional(),
    timezone: z.string().optional(),
    location: z.string().nullable().optional(),
  })).optional(),
  required: z.boolean().default(true),
  // contact_ambiguity: ONE question per ambiguous name per meeting. candidateIds = every
  // candidate whose owner/recipients name it (candidateId = the first); appliesTo = their titles.
  // Optional, so per-candidate questions stored before this still parse.
  candidateIds: z.array(z.string()).optional(),
  appliesTo: z.array(z.string()).optional(),
  // The name as the text wrote it ("Pak Budi")
  name: z.string().optional(),
});

export type ClarifierQuestion = z.infer<typeof ClarifierQuestionSchema>;

/** Candidates a question is about: candidateIds when present (grouped question), else candidateId. */
export function questionCandidateIds(q: { candidateId?: string; candidateIds?: string[] | null }): string[] {
  if (Array.isArray(q.candidateIds) && q.candidateIds.length > 0) return q.candidateIds.map(String);
  return q.candidateId ? [String(q.candidateId)] : [];
}

// ============ PIPELINE RESULT ============

export const PipelineResultSchema = z.object({
  meetingId: z.string(),
  notulen: NotulenSchema,
  candidates: z.array(ActionCandidateSchema),
  ruleWarnings: z.array(RuleWarningSchema),
  evidenceIssues: z.array(EvidenceIssueSchema),
  validatorResult: ValidatorResultSchema.optional(),
  injectionResult: InjectionResultSchema.optional(),
  redactionResult: RedactionResultSchema.optional(),
  clarifierQuestions: z.array(ClarifierQuestionSchema),
  // Candidates dropped by fatal evidence gates (not in the plan)
  rejectedCandidates: z.array(RejectedCandidateSchema).optional(),
  // Non-committal candidates moved to notulen.open_items (not in the plan)
  openItems: z.array(ActionCandidateSchema).optional(),
});

export type PipelineResult = z.infer<typeof PipelineResultSchema>;
