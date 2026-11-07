import { DAY_NAMES } from '@/lib/agent/time-hints';

/**
 * Deterministic text helpers shared by the Mock parser and Mock tool calling, so a
 * pasted chat transcript reads the same on both paths: chat prefixes are stripped,
 * the chat timestamp is the reference date (never a due date or time), pleasantries
 * are ignored and "mungkin/sebaiknya" stays a suggestion.
 */

export { parseChatLine, countChatLines, type ChatLine } from '@/lib/chat/chat-lines';

/** Clauses of one message: "kirim X, terus jadwalin Y" is two requests. Each clause is verbatim text. */
export function splitClauses(content: string): string[] {
  return content
    .split(/[.;!?]\s+|,?\s*\b(?:terus|lalu|kemudian)\b\s*/i)
    .map((c) => c.trim())
    .filter((c) => c.length > 0);
}

// Acknowledgement or courtesy: "Siap Bu, ...", "Oke", "Terima kasih", "Rapat selesai"
const ACK = /^(siap|baik|oke|ok|okay|sip|noted|iya|ya)\b/i;
const COURTESY = /^(terima kasih|makasih|thanks|thank you|selamat (pagi|siang|sore|malam)|rapat (selesai|ditutup|dimulai|dibuka))\b/i;

export const isAcknowledgement = (clause: string) => ACK.test(clause.trim());

/** Nothing to act on: courtesy, or an acknowledgement with no request in it. */
export function isPleasantry(clause: string): boolean {
  const c = clause.trim().replace(/[.!,]+$/, '');
  if (COURTESY.test(c)) return true;
  return ACK.test(c) && c.split(/\s+/).length <= 3;
}

export type Commitment = 'accepted' | 'suggestion' | 'vague' | 'question';

/** Commitment of a whole message (a request in the first clause carries to "terus ..."). */
export function commitmentOf(content: string): Commitment | '' {
  const lower = content.toLowerCase();
  if (/\?\s*$/.test(content)) return 'question';
  if (/\b(sebaiknya|mungkin|barangkali|bagaimana kalau|gimana kalau|usul(nya)?)\b/.test(lower)) return 'suggestion';
  if (/\b(perlu follow ?up|nanti saja|kapan-kapan)\b/.test(lower)) return 'vague';
  if (/\b(akan|tolong|mohon|hubungi|pastikan|jadwalkan|jadwalin|saya kirim)\b/.test(lower)) return 'accepted';
  return '';
}

/** Person named with an honorific ("Pak Budi", "Bu Sari"), day names dropped ("Pak Budi Jumat"). */
export function honorificName(text: string): string {
  const m = text.match(/\b(?:Pak|Bu|Ibu|Bapak)\s+[A-Z][a-z]+(?:\s+[A-Z][a-z]+)?/);
  if (!m) return '';
  return m[0]
    .split(/\s+/)
    .filter((w) => !DAY_NAMES.includes(w.toLowerCase()))
    .join(' ');
}

/** A clock time is written ("13:00", "jam 9", "pukul 12.30"), not just "pagi"/"siang". */
export function hasClockTime(text: string): boolean {
  return /\b\d{1,2}[.:]\d{2}\b|\b(?:jam|pukul)\s+\d{1,2}\b/i.test(text);
}

/** Short action title from a clause: no "tolong"/"ya", verb first, capitalised. */
export function titleFromClause(clause: string): string {
  const t = clause
    .trim()
    .replace(/^(tolong|mohon|bisa|coba|minta)\s+/i, '')
    .replace(/^jadwalin\b/i, 'jadwalkan')
    .replace(/[\s,]+(ya|yah|ya\s+\w+)?[.!]*$/i, '')
    .replace(/[.!,;]+$/, '')
    .trim();
  return (t.charAt(0).toUpperCase() + t.slice(1)).slice(0, 80);
}
