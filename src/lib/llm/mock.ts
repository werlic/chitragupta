import { type ZodType } from 'zod';
import type { LLMProvider, LLMMessage, LLMToolDefinition, LLMChatWithToolsResult } from './provider';
import { DAY_NAMES, inferDateTime } from '@/lib/agent/time-hints';
import { segmentText, quoteIn } from '@/lib/agent/output-guard/segmenter';
import {
  parseChatLine,
  splitClauses,
  isAcknowledgement,
  isPleasantry,
  commitmentOf,
  honorificName,
  titleFromClause,
  hasClockTime,
} from './mock-extract';

// Mock LLM for demo/tests without Ollama/cloud — deterministic output derived from the input text
export class MockLLMProvider implements LLMProvider {
  name = 'Mock (demo mode)';

  isAvailable(): boolean {
    return true;
  }

  async chat(messages: LLMMessage[]): Promise<string> {
    // Simulate delay
    await new Promise((r) => setTimeout(r, 500));
    const lastMsg = messages[messages.length - 1]?.content || '';

    const system = messages.find((m) => m.role === 'system')?.content || '';
    const json = mockJSONFor(lastMsg, system);
    if (json) return JSON.stringify(json);

    return 'Saya adalah AI assistant demo. Untuk parser penuh, jalankan Ollama atau set OPENAI_BASE_URL.';
  }

  async *streamChat(messages: LLMMessage[]): AsyncIterable<string> {
    const response = await this.chat(messages);
    const words = response.split(' ');
    for (const word of words) {
      await new Promise((r) => setTimeout(r, 10));
      yield word + ' ';
    }
  }

  async parseJSON<T>(prompt: string, schema: ZodType<T, any, any>, systemPrompt?: string): Promise<T> {
    const json = mockJSONFor(prompt, systemPrompt || '');
    if (!json) throw new Error('Mock LLM: prompt JSON tidak dikenali');
    const parsed = schema.safeParse(json);
    if (parsed.success) return parsed.data;
    throw new Error(`Mock LLM JSON parse failed: ${parsed.error.issues[0]?.message}`);
  }

  /**
   * Mock tool calling — detects intent from the user message and simulates
   * a propose_actions call. This allows the demo mode to test the
   * plan → clarify → approve flow without a real model.
   */
  async chatWithTools(
    messages: LLMMessage[],
    _tools: LLMToolDefinition[],
    _opts?: { temperature?: number; model?: string }
  ): Promise<LLMChatWithToolsResult> {
    await new Promise((r) => setTimeout(r, 500));
    const lastUserMsg = messages.filter(m => m.role === 'user').pop()?.content || '';
    const actions = mockActionsFrom(lastUserMsg);

    if (actions.length > 0) {
      return {
        content: 'Saya susun rencananya dulu. Tidak ada yang dijalankan sebelum Anda setujui.',
        toolCalls: [{
          id: `mock_call_${Date.now()}`,
          type: 'function',
          function: {
            name: 'propose_actions',
            arguments: JSON.stringify({ title: 'Rencana dari AI Assistant (mock)', actions }),
          },
        }],
      };
    }

    // No tool call — return text response
    const textResponse = await this.chat(messages);
    return { content: textResponse, toolCalls: [] };
  }
}

/**
 * Demo-mode intent extraction: one proposed action per clause that asks for
 * an email, WhatsApp, schedule or task. Chat prefixes ("[03/11/26 10:06] Sari: ")
 * are stripped and their date is the reference for "Jumat"/"besok"; courtesy lines
 * are skipped; an acknowledgement repeating an earlier request is merged into it.
 * Deliberately naive otherwise — embedded instructions are NOT filtered here,
 * so the server-side guard is exercised.
 */
function mockActionsFrom(message: string): Array<Record<string, string>> {
  const actions: Array<Record<string, string>> = [];
  let lastOwner = '';
  let refDate: Date | undefined;

  for (const rawLine of message.split('\n')) {
    const line = parseChatLine(rawLine);
    if (line.sentAt) refDate = line.sentAt;
    if (!line.content) continue;
    const commitment = commitmentOf(line.content);
    if (commitment === 'question') continue;

    for (const clause of splitClauses(line.content)) {
      if (isPleasantry(clause)) continue;
      const actionType = mockActionType(clause.toLowerCase());
      if (!actionType) continue;

      const allStaff = /all staff|semua staf/i.test(clause);
      const owner = honorificName(clause) || (allStaff ? 'Semua staf' : lastOwner);
      if (!owner) continue;

      const { dueDate, dueTime } = inferDateTime(clause, refDate);
      // "Siap Bu, notulen saya kirim ke Pak Budi hari ini" repeats the request above it
      const same = isAcknowledgement(clause) && actions.find((a) => a.actionType === actionType && a.owner === owner);
      if (same) {
        if (!same.dueDate && dueDate) same.dueDate = dueDate;
        if (!same.dueTime && dueTime) same.dueTime = dueTime;
        continue;
      }
      lastOwner = owner;

      const action: Record<string, string> = {
        actionType,
        title: titleFromClause(clause),
        owner,
        evidenceQuote: clause.slice(0, 200),
      };
      if (commitment === 'suggestion' || commitment === 'vague') action.commitmentStatus = commitment;
      if (dueDate) action.dueDate = dueDate;
      if (dueTime) action.dueTime = dueTime;
      actions.push(action);
    }
  }

  return actions;
}

/** Action type of one clause. "Rapat selesai" is not a calendar request: scheduling words are. */
function mockActionType(lower: string): string {
  if (/whatsapp|\bwa\b/.test(lower)) return 'whatsapp';
  if (/jadwal\w*|undang\w*|kalender|follow[- ]?up/.test(lower) && !/notulen/.test(lower)) return 'calendar';
  if (/email|kirim|forward|teruskan/.test(lower)) return 'email';
  if (/\btask\b|tugas/.test(lower)) return 'task';
  return '';
}

// ============ Deterministic JSON tasks (parser / validator / clarifier) ============

/**
 * Route a JSON prompt to the matching mock task. Routing uses the system prompt
 * and explicit markers, never loose words like "action" (the validator prompt
 * contains candidate JSON with "actionType").
 */
function mockJSONFor(prompt: string, system: string): unknown | null {
  const sys = system.toLowerCase();
  if (sys.includes('validator')) return mockValidate(prompt);
  if (sys.includes('parser')) return { candidates: mockParse(prompt) };
  if (/"questions"/.test(prompt)) return { questions: [] };
  if (/ekstrak/i.test(prompt)) return { candidates: mockParse(prompt) };
  if (/cross-check/i.test(prompt)) return mockValidate(prompt);
  return null;
}

function quotedBlock(prompt: string): string {
  return prompt.match(/"""\s*([\s\S]*?)\s*"""/)?.[1] ?? '';
}

const NON_NAMES = new Set(['saya', 'kami', 'kita', 'tim', 'pak', 'bu', 'ya', 'baik', 'bagus', 'bisa', 'siap', 'direktur', 'oke', 'ok', 'semua', 'untuk']);

/**
 * Mock parser: one candidate per request clause ("kirim X, terus jadwalin Y" = two)
 * of a segment that carries an action verb plus a commitment/suggestion/question
 * marker. evidenceQuote is copied verbatim from the segment so the evidence gates
 * see a real quote. The chat timestamp is the reference date for relative days and
 * never a due date/time; an acknowledgement repeating an earlier request is merged.
 */
function mockParse(prompt: string): Array<Record<string, unknown>> {
  const block = quotedBlock(prompt);
  const labelled = [...block.matchAll(/^\[(seg-\d+)\]\s*(.*)$/gm)].map((m) => ({ id: m[1], text: m[2] }));
  const segments = labelled.length > 0 ? labelled : segmentText(block);

  const out: Array<Record<string, unknown>> = [];
  let refDate: Date | undefined;
  for (const seg of segments) {
    // Speaker prefix "[27/10/26 09:07] Budi Santoso: ..." (timestamp optional)
    const line = parseChatLine(seg.text);
    if (line.sentAt) refDate = line.sentAt;
    const speaker = line.speaker;
    const content = line.content;

    let commitmentStatus: string = commitmentOf(content);
    if (!commitmentStatus) continue;

    // Owner: the person addressed ("Sari, tolong ...") else the speaker / "X akan ..."
    const addressed = content.match(/(?:^|[.!]\s+|\b(?:Ya|Baik|Bagus)\s+)([A-Z][a-z]+),\s/);
    const subject = content.match(/\b((?:Pak|Bu)\s+)?([A-Z][a-z]+(?:\s+[A-Z][a-z]+)?)\s+akan\b/);
    let baseOwner = speaker;
    let ownerIsSpeaker = true;
    if (addressed && !NON_NAMES.has(addressed[1].toLowerCase())) { baseOwner = addressed[1]; ownerIsSpeaker = false; }
    else if (!baseOwner && subject && !/^(saya|kami|kita|aku)$/i.test(subject[2])) { baseOwner = subject[0].replace(/\s+akan$/, ''); ownerIsSpeaker = false; }

    // Only joined requests are split ("..., terus jadwalin ..."); sentences of one request stay together
    const clauses = content.split(/,?\s*\b(?:terus|lalu|kemudian)\b\s*/i).map((c) => c.trim()).filter(Boolean);
    // One clause → the whole segment is the quote (as before); several → each request quoted alone
    const parts = clauses.length > 1 ? clauses : [content];
    let segRecipient = '';
    for (const part of parts) {
      if (parts.length > 1 && isPleasantry(part)) continue;
      const lower = part.toLowerCase();
      let actionType = '';
      if (/whatsapp|\bwa\b/.test(lower)) actionType = 'whatsapp';
      else if (/undangan|\bundang\b|kalender|jadwalkan|jadwalin|dijadwalkan|follow-up meeting/.test(lower)) actionType = 'calendar';
      else if (/email|\bkirim\b/.test(lower)) actionType = 'email';
      else if (/\btask\b|tugas|siapkan|susun|catat|\bcek\b|proses|review|koordinasi|hubungi/.test(lower)) actionType = 'task';
      if (!actionType) continue;

      // Messages go to the person named ("kirim notulen ke Pak Budi"), unless someone was addressed;
      // a follow-up in the same message ("terus jadwalin ...") is with that person too
      const recipient = honorificName(part) || segRecipient;
      if (honorificName(part)) segRecipient = honorificName(part);
      let owner = baseOwner;
      if (ownerIsSpeaker && actionType !== 'task' && recipient && !isAcknowledgement(content)) owner = recipient;
      if (!owner) continue;

      const hint = inferDateTime(part, refDate);
      const dueDate = hint.dueDate;
      // "Jumat siang" is not a clock time (AGENTS.md): leave it empty, the rule checker proposes one
      const dueTime = hasClockTime(part) ? hint.dueTime : undefined;

      // "Siap Bu, notulen saya kirim ke Pak Budi hari ini" repeats the request above it
      if (isAcknowledgement(content) && recipient) {
        const same = out.find((c) => c.actionType === actionType && c.owner === recipient);
        if (same) {
          if (!same.dueDate && dueDate) same.dueDate = dueDate;
          if (!same.dueTime && dueTime) same.dueTime = dueTime;
          continue;
        }
      }

      const quote = part.slice(0, 200);
      out.push({
        id: `cand-${String(out.length + 1).padStart(2, '0')}`,
        title: (parts.length > 1 ? titleFromClause(part) : part).slice(0, 80),
        owner,
        ...(dueDate ? { dueDate } : {}),
        ...(dueTime ? { dueTime } : {}),
        commitmentStatus,
        evidenceQuote: quote,
        sourceSegmentId: seg.id,
        actionType,
        recipients: [],
        isExternal: /\bPT\s+[A-Z]/.test(part),
        recipientCount: 0,
      });
    }
  }
  return out;
}

/**
 * Mock validator: a candidate matches when its quote is in the original text.
 */
function mockValidate(prompt: string): { matches: string[]; mismatches: string[]; warnings: string[] } {
  const original = quotedBlock(prompt);
  const planJSON = prompt.slice(prompt.lastIndexOf('"""') + 3).match(/\[[\s\S]*\]/)?.[0] ?? '[]';
  let candidates: Array<{ id?: string; evidenceQuote?: string; commitmentStatus?: string }> = [];
  try {
    candidates = JSON.parse(planJSON);
  } catch {
    return { matches: [], mismatches: [], warnings: ['Mock validator: rencana tidak bisa dibaca.'] };
  }

  const result = { matches: [] as string[], mismatches: [] as string[], warnings: [] as string[] };
  for (const c of candidates) {
    if (!c.id) continue;
    if (c.evidenceQuote && quoteIn(c.evidenceQuote, original)) result.matches.push(c.id);
    else result.mismatches.push(c.id);
    if (c.commitmentStatus && c.commitmentStatus !== 'accepted') {
      result.warnings.push(`${c.id}: bukan komitmen pasti (${c.commitmentStatus}).`);
    }
  }
  return result;
}
