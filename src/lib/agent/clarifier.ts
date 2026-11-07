import { z } from 'zod';
import { getLLMProviderAsync } from '@/lib/llm';
import { prisma } from '@/lib/db';
import type { ActionCandidate } from './types';
import type { ClarifierQuestion } from './types';
import { matchContactsByName } from '@/lib/contacts/match';
import { explicitZone, zonesForCandidate } from './zones';

// Built lazily (inside the LLM try block) so a missing/stubbed zod never breaks rule checks
const llmQuestionsSchema = () =>
  z.object({
    questions: z
      .array(z.union([z.string().min(1), z.object({ question: z.string().min(1), candidateId: z.string().optional() })]))
      .max(5),
  });

const DATE_QUESTION = /\b(kapan|tanggal|tgl|deadline|tenggat|jatuh tempo|batas waktu|hari apa)\b/i;

/** The candidate an LLM question is about: the id it named, else the one whose title shares the most words. */
function questionCandidate(question: string, candidateId: string | undefined, candidates: ActionCandidate[]): string {
  if (candidateId && candidates.some((c) => c.id === candidateId)) return candidateId;
  const words = new Set(question.toLowerCase().split(/\W+/).filter((w) => w.length > 2));
  let best = candidates[0];
  let bestScore = 0;
  for (const c of candidates) {
    const score = c.title.toLowerCase().split(/\W+/).filter((w) => words.has(w)).length;
    if (score > bestScore) [best, bestScore] = [c, score];
  }
  return best?.id || 'unknown';
}

/**
 * Clarifier: ask questions ONLY if there is real ambiguity.
 * Now queries the Contact table to detect:
 * 1. Ambiguous owner name (two "Budi" in contacts) → "Budi yang mana?"
 * 2. Single match → no question (Bu Sari → resolve directly)
 * 3. Timezone reference ambiguity (if time given without zone and participants from different zones)
 * 4. Vague commitment status
 * 5. Missing due date on time-sensitive actions
 */
export async function clarify(
  candidates: ActionCandidate[],
  originalText: string,
  participants: string[] = [],
  creatorTimezone?: string
): Promise<ClarifierQuestion[]> {
  const questions: ClarifierQuestion[] = [];

  // Batch-load all contacts once for efficiency
  const allContacts = await prisma.contact.findMany();

  // ============ Check 1: Ambiguous owner — query contacts ============
  // Ask only when the owner name (honorific stripped) matches MORE THAN ONE contact:
  //   "Pak Budi"       -> Budi Santoso + Budi Hartono -> ask "Budi yang mana?"
  //   "Budi Santoso"   -> exactly one                 -> no question
  //   "Bu Sari"        -> exactly one                 -> no question
  // One question per ambiguous NAME per meeting: "Pak Budi", "Budi" and "Bapak Budi" match
  // the same contacts, so they share one question and one answer for every action naming them
  // (owner or recipients). Asking per action would let the reviewer pick a different Budi each time.
  const groups = new Map<string, { name: string; matches: typeof allContacts; ids: string[]; titles: string[] }>();
  for (const c of candidates) {
    for (const name of [c.owner, ...(c.recipients || [])]) {
      if (!name || name.includes('@')) continue;
      const matches = matchContactsByName(allContacts, name);
      if (matches.length <= 1) continue;
      const key = matches.map((m) => m.id).sort().join('|');
      const g = groups.get(key) ?? { name, matches, ids: [], titles: [] };
      groups.set(key, g);
      if (!g.ids.includes(c.id)) {
        g.ids.push(c.id);
        g.titles.push(c.title);
      }
    }
  }
  for (const g of groups.values()) {
    const label = g.name.replace(/^(Pak|Bu|Bapak|Ibu)\s+/i, '').trim().split(/\s+/)[0];
    questions.push({
      id: `clarify-${g.ids[0]}-contact`,
      type: 'contact_ambiguity',
      candidateId: g.ids[0],
      candidateIds: g.ids,
      appliesTo: g.titles,
      name: g.name,
      question: `"${g.name}" merujuk ke ${g.matches.length} kontak. ${label} yang mana?`,
      options: g.matches.map(m => ({
        value: m.id,
        label: `${m.name} (${m.role || 'Staff'}, ${m.department || '-'})`,
        role: m.role ?? null,
        department: m.department ?? null,
        timezone: m.timezone || 'WIB',
        location: m.location ?? null,
      })),
      required: true,
    });
  }

  // ============ Check 2: Timezone reference ambiguity ============
  // Ask only when a time is given without an explicit zone AND the people/places in
  // THIS action (owner, participants, recipients, names & cities in its text, creator)
  // span more than one zone. A zone written in the action's own text, on the line
  // its quote came from, or in a one-line request, counts as explicit.
  const lines = originalText.split(/\r?\n/).filter((l) => l.trim());
  const singleLine = lines.length <= 1;
  const textZone = singleLine ? explicitZone(originalText) : null;
  for (const c of candidates) {
    if (!c.dueTime || c.dueTime.length === 0) continue;
    const quote = (c.evidenceQuote || '').toLowerCase().slice(0, 30);
    const sourceLine = quote.length >= 5 ? lines.find((l) => l.toLowerCase().includes(quote)) || '' : '';
    if (textZone || explicitZone(`${c.title} ${c.evidenceQuote} ${sourceLine}`)) continue;

    const zones = zonesForCandidate(c, allContacts, participants, creatorTimezone);
    if (zones.size > 1) {
      questions.push({
        id: `clarify-${c.id}-timezone`,
        type: 'timezone_reference',
        candidateId: c.id,
        question: `Waktu ${c.dueTime} disebut tanpa zona acuan, sedangkan pihak terkait ada di ${[...zones].join('/')}. Zona acuan: WIB/WITA/WIT?`,
        options: [
          { value: 'WIB', label: 'WIB (Waktu Indonesia Barat)' },
          { value: 'WITA', label: 'WITA (Waktu Indonesia Tengah)' },
          { value: 'WIT', label: 'WIT (Waktu Indonesia Timur)' },
        ],
        required: true,
      });
    }
  }

  // ============ Check 3: Vague commitment status ============
  for (const c of candidates) {
    if (c.commitmentStatus === 'vague') {
      questions.push({
        id: `clarify-${c.id}-vague`,
        type: 'vague_commitment',
        candidateId: c.id,
        question: `Tindakan "${c.title}" masih belum spesifik. Apakah ini komitmen pasti?`,
        options: [
          { value: 'accepted', label: 'Ya, komitmen pasti' },
          { value: 'suggestion', label: 'Hanya saran' },
        ],
        required: true,
      });
    }
  }

  // ============ Check 4: Missing due date on time-sensitive actions ============
  for (const c of candidates) {
    if (!c.dueDate && (c.actionType === 'email' || c.actionType === 'calendar')) {
      questions.push({
        id: `clarify-${c.id}-duedate`,
        type: 'missing_due_date',
        candidateId: c.id,
        question: `Tindakan "${c.title}" (${c.actionType}) tidak memiliki tanggal jatuh tempo. Kapan harus diselesaikan?`,
        required: true,
      });
    }
  }

  // If rule-based checks found questions (or nothing to ask about), no need for LLM
  if (questions.length > 0 || candidates.length === 0) return questions;

  // ============ LLM-based clarification only if no rule-based questions ============
  try {
    const llm = await getLLMProviderAsync();
    const prompt = `Analisis kandidat aksi berikut dan teks rapat asli.
    Apakah ada ambiguitas NYATA yang perlu diklarifikasi?
    Hanya tanyakan jika benar-benar ambigu (tidak bisa diselesaikan dari konteks).
    Return JSON: { "questions": [{ "question": "...", "candidateId": "<id kandidat>" }] } atau { "questions": [] } jika tidak ada.

    Kandidat: ${JSON.stringify(candidates)}
    Teks asli: ${originalText}`;

    const result = await llm.parseJSON(prompt, llmQuestionsSchema());

    // Convert LLM string questions to structured format
    // A free-text "Kapan ...?" answer must reach the candidate's due date, so date
    // questions are typed missing_due_date (the clarify route applies those)
    return result.questions.map((raw, i) => {
      const q = typeof raw === 'string' ? { question: raw, candidateId: undefined } : raw;
      return {
        id: `clarify-llm-${i}`,
        type: DATE_QUESTION.test(q.question) ? ('missing_due_date' as const) : ('vague_commitment' as const),
        candidateId: questionCandidate(q.question, q.candidateId, candidates),
        question: q.question,
        required: true,
      };
    });
  } catch (error) {
    console.warn('[Clarifier] LLM check skipped:', error instanceof Error ? error.message : error);
    return questions;
  }
}
