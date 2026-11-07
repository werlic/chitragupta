export interface Segment {
  id: string; // seg-01, seg-02, ...
  text: string;
}

/**
 * Split cleaned meeting text into numbered segments (pure, deterministic).
 * Multi-line text (chat export, notes) → one segment per non-empty line.
 * Single-line text (a chat request) → one segment per sentence.
 * The parser prompt and the evidence validator both use this, so a
 * sourceSegmentId from the LLM can be checked against the same segments.
 */
export function segmentText(text: string): Segment[] {
  const lines = text.split(/\r?\n/).map((l) => l.trim()).filter((l) => l.length > 0);
  const parts = lines.length > 1
    ? lines
    : (lines[0] ?? '').split(/(?<=[.!?])\s+/).map((s) => s.trim()).filter((s) => s.length > 0);
  return parts.map((t, i) => ({ id: segmentId(i + 1), text: t }));
}

export function segmentId(n: number): string {
  return `seg-${String(n).padStart(2, '0')}`;
}

/**
 * Prompt form: "[seg-01] ..." per line, so the LLM can cite segment ids.
 */
export function formatSegments(segments: Segment[]): string {
  return segments.map((s) => `[${s.id}] ${s.text}`).join('\n');
}

/**
 * Lowercase, punctuation → space, collapse whitespace. Used for quote matching.
 */
export function normalizeForMatch(text: string): string {
  return text
    .toLowerCase()
    .replace(/\[(quarantined|redacted[^\]]*|seg-\d+)\]/g, ' ')
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * True when a (normalized) quote appears in a (normalized) haystack.
 * Tolerant to a truncated/paraphrased tail: the first 30 chars are enough.
 */
export function quoteIn(quote: string, haystack: string): boolean {
  const q = normalizeForMatch(quote);
  if (q.length === 0) return false;
  const h = normalizeForMatch(haystack);
  return h.includes(q) || (q.length > 30 && h.includes(q.slice(0, 30)));
}
