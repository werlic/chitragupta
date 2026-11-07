import { countChatLines, parseChatLine } from './chat-lines';

/**
 * A pasted meeting (chat export or notes) is processed like the Meeting form / `b1 plan`:
 * runPipeline (input guard → parser → gates → planCandidates), not free-form tool calling.
 */

const nonEmptyLines = (text: string) => text.split('\n').map((l) => l.trim()).filter(Boolean);

/** Two or more timestamped "Nama: ..." lines, or three or more lines of text. */
export function isMeetingTranscript(text: string): boolean {
  return countChatLines(text) >= 2 || nonEmptyLines(text).length >= 3;
}

export function transcriptLineCount(text: string): number {
  return nonEmptyLines(text).length;
}

/** Meeting title from the first meaningful line: "Rapat koordinasi mingguan dimulai. Agenda: …" → "Rapat koordinasi mingguan". */
export function transcriptTitle(cleanedText: string): string | null {
  for (const raw of nonEmptyLines(cleanedText)) {
    if (raw.includes('[QUARANTINED]')) continue;
    const content = parseChatLine(raw).content;
    const sentence = content.split(/[.!?]\s|:\s/)[0].replace(/[.!?:]+$/, '').trim();
    const title = sentence.replace(/\s+(dimulai|dibuka|kita mulai)$/i, '').trim();
    if (title.split(/\s+/).length >= 2) return title.slice(0, 80);
  }
  return null;
}

/** Speakers of the chat lines (attendees), in order of first appearance. */
export function transcriptSpeakers(cleanedText: string): string[] {
  const names: string[] = [];
  for (const raw of nonEmptyLines(cleanedText)) {
    if (raw.includes('[QUARANTINED]')) continue;
    const { speaker, sentAt } = parseChatLine(raw);
    if (speaker && sentAt && !names.includes(speaker)) names.push(speaker);
  }
  return names;
}
