import { z } from 'zod';
import type { Role } from '@prisma/client';
import { prisma } from '@/lib/db';
import { checkToolPermission, type ToolType } from './execution/permission-gate';
import { logAudit } from './audit-logger';
import { getRetentionDate, logConsent } from './input-guard/consent-logger';
import { planCandidates, logInputGuard, guardStage, PipelineFailedError, type GuardedText } from './orchestrator';
import type { ActionCandidate, PipelineResult } from './types';
import { multiZoneDisplay } from '@/lib/utils/timezone';
import { inferDateTime } from './time-hints';
import type { LLMToolDefinition } from '@/lib/llm/provider';

export interface ToolDefinition {
  name: ToolType;
  description: string;
  inputSchema: z.ZodSchema;
  requiredPermission: string;
}

export interface ToolResult {
  success: boolean;
  data?: Record<string, unknown>;
  error?: string;
  responseToUser?: string;
}

export interface ToolCallRequest {
  tool: ToolType;
  input: Record<string, unknown>;
}

export interface AuthUser {
  userId: string;
  name: string;
  role: Role;
  timezone: string;
  location?: string | null;
  department?: string | null;
}

const ProposedActionSchema = z.object({
  actionType: z.enum(['email', 'calendar', 'task', 'whatsapp']).describe('Jenis aksi: email, calendar (jadwal rapat), task, atau whatsapp'),
  title: z.string().describe('Ringkasan aksi, misalnya "Kirim notulen rapat logistik"'),
  owner: z.string().describe('Nama orang yang dituju atau ditugaskan, persis seperti ditulis pengguna (misalnya "Pak Budi")'),
  dueDate: z.string().optional().describe('Tanggal YYYY-MM-DD, hanya jika disebut atau tersirat jelas'),
  dueTime: z.string().optional().describe('Jam HH:MM, hanya jika disebut'),
  location: z.string().optional().describe('Lokasi, jika disebut'),
  evidenceQuote: z.string().describe('Kutipan persis dari pesan pengguna yang meminta aksi ini'),
  commitmentStatus: z
    .enum(['accepted', 'suggestion', 'vague', 'question'])
    .optional()
    .describe('accepted bila diminta jelas; suggestion bila hanya saran ("mungkin", "sebaiknya"); vague bila tidak jelas; question bila masih pertanyaan'),
});

const ProposeActionsSchema = z.object({
  title: z.string().describe('Judul singkat rencana'),
  actions: z.array(ProposedActionSchema).describe('Daftar aksi yang diminta pengguna'),
});

/**
 * Tool definitions available to the AI assistant.
 * The assistant has NO tool that executes an action. propose_actions only
 * creates a plan (PENDING candidates); execution happens exclusively through
 * /api/agent/approve after a person approves the exact details.
 */
export const TOOL_DEFINITIONS: ToolDefinition[] = [
  {
    name: 'propose_actions',
    description:
      'Susun rencana aksi (email, jadwal, task, WhatsApp) dari permintaan pengguna. ' +
      'Tool ini TIDAK mengirim atau menjadwalkan apa pun: rencana masuk ke layar persetujuan ' +
      'dan baru dijalankan setelah pengguna menyetujuinya.',
    inputSchema: ProposeActionsSchema,
    requiredPermission: 'meeting:create',
  },
];

/**
 * Get tool descriptions for the LLM system prompt (used as fallback for
 * streaming mode where native tool calling isn't available).
 * Parameters are rendered from the same JSON Schema that native tool calling uses,
 * so both paths always agree.
 */
export function getToolDescriptionsForPrompt(): string {
  return TOOL_DEFINITIONS.map(t => {
    const { properties, required } = zodToProperties(t.inputSchema);
    const params = Object.entries(properties)
      .map(([key, def]) => {
        const req = required.includes(key) ? 'wajib' : 'opsional';
        return `${key} (${def.type}, ${req})${def.description ? `: ${def.description}` : ''}`;
      })
      .join('; ');
    return `- ${t.name}: ${t.description}\n  Parameter: ${params}\n  Requires permission: ${t.requiredPermission}`;
  }).join('\n\n');
}

type JsonSchemaNode = {
  type: string;
  description?: string;
  enum?: string[];
  items?: JsonSchemaNode;
  properties?: Record<string, JsonSchemaNode>;
  required?: string[];
};

/**
 * Convert a Zod type to a JSON Schema node (recursive).
 * NOTE: In Zod v3 `_def.shape` is a *function*, so it must be read via `schema.shape`
 * (ZodObject getter). Reading `_def.shape` directly yields no properties, which sent
 * tools to the LLM with empty parameters and made it guess arguments (e.g. title = "String").
 */
function zodToJsonSchema(schema: z.ZodTypeAny): JsonSchemaNode {
  let inner: z.ZodTypeAny = schema;
  let description: string | undefined = schema.description;

  // Unwrap Optional / Nullable / Default wrappers, keeping the outermost description
  while (
    inner instanceof z.ZodOptional ||
    inner instanceof z.ZodNullable ||
    inner instanceof z.ZodDefault
  ) {
    inner = inner._def.innerType as z.ZodTypeAny;
    description = description ?? inner.description;
  }

  let node: JsonSchemaNode;
  if (inner instanceof z.ZodNumber) {
    node = { type: 'number' };
  } else if (inner instanceof z.ZodBoolean) {
    node = { type: 'boolean' };
  } else if (inner instanceof z.ZodEnum) {
    node = { type: 'string', enum: [...(inner.options as string[])] };
  } else if (inner instanceof z.ZodArray) {
    node = { type: 'array', items: zodToJsonSchema(inner.element as z.ZodTypeAny) };
  } else if (inner instanceof z.ZodObject) {
    const { properties, required } = zodToProperties(inner);
    node = { type: 'object', properties, required };
  } else {
    node = { type: 'string' };
  }

  description = description ?? inner.description;
  if (description) node.description = description;
  return node;
}

/**
 * Convert a ZodObject into JSON Schema `properties` + `required` for LLM tool definitions.
 */
function zodToProperties(schema: z.ZodTypeAny): { properties: Record<string, JsonSchemaNode>; required: string[] } {
  const properties: Record<string, JsonSchemaNode> = {};
  const required: string[] = [];

  if (!(schema instanceof z.ZodObject)) return { properties, required };

  for (const [key, field] of Object.entries(schema.shape as Record<string, z.ZodTypeAny>)) {
    properties[key] = zodToJsonSchema(field);
    if (!field.isOptional()) required.push(key);
  }

  return { properties, required };
}

/**
 * Generate LLMToolDefinition[] in the format that Ollama/OpenAI function calling expects.
 * This is the proper way to expose tools to the LLM — instead of hoping it writes
 * "TOOL_CALL: {...}" in its text response, the LLM natively decides to call a function.
 */
export function getToolDefinitionsForLLM(): LLMToolDefinition[] {
  return TOOL_DEFINITIONS.map(t => {
    const { properties, required } = zodToProperties(t.inputSchema);
    return {
      type: 'function',
      function: {
        name: t.name,
        description: t.description,
        parameters: {
          type: 'object',
          properties,
          required,
        },
      },
    };
  });
}

/**
 * Detect if the AI response contains a tool call request.
 * DEPRECATED: This regex-based detection is kept as fallback for streaming mode.
 * Prefer using `chatWithTools` + `proposeFromToolCalls` for native function calling.
 */
export function detectToolCall(aiResponse: string): ToolCallRequest | null {
  const toolCallMatch = aiResponse.match(/TOOL_CALL:\s*({[\s\S]*})/);
  if (!toolCallMatch) return null;

  try {
    const parsed = JSON.parse(toolCallMatch[1]) as ToolCallRequest;
    if (parsed.tool && TOOL_DEFINITIONS.find(t => t.name === parsed.tool)) {
      return parsed;
    }
  } catch {
    // Not valid JSON
  }

  return null;
}

/**
 * Turn native LLM tool calls into plans awaiting approval.
 * `source` is the guarded user message the plan must be grounded in.
 */
export async function proposeFromToolCalls(
  llmToolCalls: Array<{ id: string; function: { name: string; arguments: string } }>,
  user: AuthUser,
  source: GuardedText
): Promise<ToolResult[]> {
  const results: ToolResult[] = [];

  for (const tc of llmToolCalls) {
    let input: Record<string, unknown>;
    try {
      input = JSON.parse(tc.function.arguments);
    } catch {
      results.push({
        success: false,
        error: `Invalid JSON arguments for tool "${tc.function.name}"`,
        responseToUser: `Maaf, argumen untuk tool "${tc.function.name}" tidak valid.`,
      });
      continue;
    }

    results.push(await proposeToolCall({ tool: tc.function.name as ToolType, input }, user, source));
  }

  return results;
}

/**
 * Handle one tool call with permission checking. Never executes an action.
 */
export async function proposeToolCall(
  toolCall: ToolCallRequest,
  user: AuthUser,
  source: GuardedText
): Promise<ToolResult> {
  if (!TOOL_DEFINITIONS.find(t => t.name === toolCall.tool)) {
    return {
      success: false,
      error: `Unknown tool: ${toolCall.tool}`,
      responseToUser: `Tool "${toolCall.tool}" tidak tersedia. Saya hanya bisa menyusun rencana untuk Anda setujui.`,
    };
  }

  const permCheck = checkToolPermission(user.role, toolCall.tool);
  if (!permCheck.allowed) {
    await logAudit({
      type: 'AI_TOOL_CALL_DENIED',
      userId: user.userId,
      payload: {
        tool: toolCall.tool,
        input: toolCall.input,
        reason: permCheck.reason,
        missingPermission: permCheck.missingPermission,
      },
    });
    return {
      success: false,
      error: permCheck.reason || 'Permission denied',
      responseToUser: `Maaf, peran Anda tidak diizinkan membuat rencana aksi (perlu izin "${permCheck.missingPermission}").`,
    };
  }

  const parsed = ProposeActionsSchema.safeParse(toolCall.input);
  if (!parsed.success || parsed.data.actions.length === 0) {
    return {
      success: false,
      error: parsed.success ? 'No actions provided' : parsed.error.issues[0]?.message,
      responseToUser: 'Saya belum bisa menyusun rencana dari permintaan itu. Bisa sebutkan aksi, orang, dan waktunya?',
    };
  }

  return proposeActions(parsed.data, user, source);
}

async function proposeActions(
  input: z.infer<typeof ProposeActionsSchema>,
  user: AuthUser,
  source: GuardedText
): Promise<ToolResult> {
  const title = input.title.slice(0, 100) || 'Rencana dari AI Assistant';

  const meeting = await prisma.meeting.create({
    data: {
      title,
      rawText: source.cleanedText,
      status: 'PROCESSING',
      creatorId: user.userId,
      participants: [],
      retentionUntil: getRetentionDate(),
    },
  });

  // From here on the meeting exists: any failure → REJECTED + PIPELINE_FAILED, never PROCESSING
  let result: PipelineResult;
  try {
    result = await guardStage(meeting.id, user.userId, 'ai_chat', async () => {
      await logAudit({
        type: 'AI_PLAN_PROPOSED',
        meetingId: meeting.id,
        userId: user.userId,
        payload: { tool: 'propose_actions', input, source: 'ai-chat' },
      });
      await logConsent(
        meeting.id,
        {
          participantName: user.name,
          consentGiven: true,
          consentTimestamp: new Date().toISOString(),
          retentionUntil: getRetentionDate().toISOString(),
        },
        user.userId
      );
      await logInputGuard(meeting.id, user.userId, source);

      // Models often leave date/time empty even when the user said "Jumat siang";
      // fill them from the user's own words so the rule checks still apply
      const candidates: ActionCandidate[] = input.actions.map((a, i) => ({
        id: `cand-${String(i + 1).padStart(2, '0')}`,
        title: a.title,
        owner: a.owner,
        dueDate: a.dueDate || inferDateTime(a.evidenceQuote).dueDate,
        dueTime: a.dueTime || inferDateTime(a.evidenceQuote).dueTime,
        location: a.location || undefined,
        // Suggestions stay suggestions: planCandidates moves them to open items, not actions
        commitmentStatus: a.commitmentStatus ?? 'accepted',
        evidenceQuote: (a.evidenceQuote || '').slice(0, 200),
        sourceSegmentId: 'ai-chat',
        actionType: a.actionType,
        recipients: [],
        isExternal: false,
        recipientCount: 0,
      }));

      return planCandidates({
        meetingId: meeting.id,
        title,
        userId: user.userId,
        userName: user.name,
        // Chat has no attendee list: owners come from the actions (resolved by the clarifier);
        // participants stays empty so calendar invites don't silently add extra recipients.
        participants: [],
        candidates,
        guarded: source,
        creatorTimezone: user.timezone,
      });
    });
  } catch (err) {
    if (!(err instanceof PipelineFailedError)) throw err;
    return {
      success: false,
      error: 'PIPELINE_FAILED',
      data: { meetingId: meeting.id },
      responseToUser: 'Maaf, rencana gagal disusun. Belum ada aksi yang dijalankan. Coba kirim ulang permintaan Anda.',
    };
  }

  return {
    success: true,
    data: { meetingId: meeting.id, candidateCount: result.candidates.length },
    responseToUser: formatPlanSummary(result, input.actions.length),
  };
}

const ACTION_LABEL: Record<ActionCandidate['actionType'], string> = {
  email: 'Email',
  calendar: 'Jadwal',
  task: 'Task',
  whatsapp: 'WhatsApp',
};

/**
 * Deterministic chat summary of a plan. Always states that nothing has run yet
 * and links to the approval screen.
 */
export function formatPlanSummary(result: PipelineResult, proposedCount: number): string {
  const lines: string[] = ['📋 Rencana disusun. Belum ada yang dikirim, dijadwalkan, atau dibuat.', ''];

  result.candidates.forEach((c, i) => {
    const when = [c.dueDate, c.dueTime ? multiZoneDisplay(c.dueTime, 'WIB') : ''].filter(Boolean).join(' ');
    lines.push(`${i + 1}. [${ACTION_LABEL[c.actionType]}] ${c.title} → ${c.owner}${when ? ` · ${when}` : ''}`);
    for (const w of result.ruleWarnings.filter(w => w.candidateId === c.id)) {
      const suggestion = [w.suggestedDate, w.suggestedTime].filter(Boolean).join(' ');
      lines.push(`   ⚠️ ${w.message}${suggestion ? ` Saran: ${suggestion}` : ''}`);
    }
  });

  if (result.injectionResult?.detected) {
    const quoted = result.injectionResult.quarantinedSegments.map(s => `"${s.text.trim()}"`).join(', ');
    lines.push('', `🛡️ Ada instruksi tertanam di teks (${quoted}). Saya memperlakukannya sebagai data dan tidak menjalankannya.`);
  }
  const dropped = proposedCount - result.candidates.length;
  if (dropped > 0) {
    lines.push(`🛡️ ${dropped} aksi tidak dimasukkan ke rencana karena tidak valid atau berasal dari instruksi tertanam.`);
  }

  if (result.clarifierQuestions.length > 0) {
    lines.push('', '❓ Perlu klarifikasi sebelum bisa disetujui:');
    for (const q of result.clarifierQuestions) {
      lines.push(`- ${q.question}`);
    }
  }

  lines.push('', `Tinjau dan setujui di: /dashboard/meetings/${result.meetingId}`);
  return lines.join('\n');
}
