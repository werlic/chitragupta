/**
 * Chat-export lines ("[03/11/26 10:06] Sari Wijaya: ...", "03/11/26 10.06 - Sari: ...").
 * Pure parsing shared by the AI chat route (is this a pasted meeting?) and the Mock LLM.
 */

export interface ChatLine {
  speaker: string;
  content: string;
  /** Date of the chat timestamp, used as "today" for relative days */
  sentAt?: Date;
}

// "[03/11/26 10:06] Sari Wijaya: ...", "[10:06] Sari: ..." (speaker optional)
const BRACKET_LINE = /^\[([^\]]*)\]\s*(?:([A-Z][^:\d[\]]{0,39}):\s+)?(.*)$/;
// WhatsApp export: "03/11/26 10.06 - Sari Wijaya: ..."
const DASH_LINE = /^(\d{1,2}[/.-]\d{1,2}[/.-]\d{2,4}),?\s+\d{1,2}[.:]\d{2}\s*-\s*([^:]{1,40}):\s+(.*)$/;
const SPEAKER_LINE = /^([A-Z][^:\d[\]]{0,39}):\s+(.*)$/;
// A timestamped line with a speaker, either shape
const STAMPED_SPEAKER = /^\[[^\]]*\d[^\]]*\]\s*[A-Z][^:\d[\]]{0,39}:\s/;

function stampDate(stamp: string): Date | undefined {
  const m = stamp.match(/(\d{1,2})[/.-](\d{1,2})[/.-](\d{2,4})/);
  if (!m) return undefined;
  const y = m[3].length === 2 ? 2000 + Number(m[3]) : Number(m[3]);
  const d = new Date(y, Number(m[2]) - 1, Number(m[1]));
  return d.getMonth() === Number(m[2]) - 1 ? d : undefined;
}

/** Split one line into speaker, content and timestamp date (all optional). */
export function parseChatLine(line: string): ChatLine {
  const text = line.trim();
  const dash = text.match(DASH_LINE);
  if (dash) return { speaker: dash[2].trim(), content: dash[3].trim(), sentAt: stampDate(dash[1]) };
  const br = text.match(BRACKET_LINE);
  if (br && /\d/.test(br[1])) return { speaker: (br[2] || '').trim(), content: br[3].trim(), sentAt: stampDate(br[1]) };
  const sp = text.match(SPEAKER_LINE);
  if (sp) return { speaker: sp[1].trim(), content: sp[2].trim() };
  return { speaker: '', content: text };
}

/** Number of timestamped "Nama: ..." lines. */
export function countChatLines(text: string): number {
  return text.split('\n').filter((l) => DASH_LINE.test(l.trim()) || STAMPED_SPEAKER.test(l.trim())).length;
}
