import type { ActionCandidate, EvidenceIssue, RejectedCandidate } from '../types';
import { matchContactsByName } from '@/lib/contacts/match';
import { segmentText, normalizeForMatch, quoteIn } from './segmenter';

export interface EvidenceContact {
  name: string;
}

export interface EvidenceResult {
  accepted: ActionCandidate[];
  rejected: RejectedCandidate[];
  issues: EvidenceIssue[];
}

// Gates that drop a candidate from the plan; the rest are warnings for the reviewer
const FATAL_GATES: ReadonlySet<EvidenceIssue['gate']> = new Set(['evidence_not_found', 'owner_unknown', 'deadline_invalid', 'duplicate']);

/**
 * 5 gates: evidence_not_found, source_segment_mismatch, owner_unknown, deadline_invalid, duplicate.
 * Pure: contacts are passed in (Contact table rows), text is the cleaned meeting text.
 */
export function validateEvidence(
  candidates: ActionCandidate[],
  originalText: string,
  contacts: EvidenceContact[] = []
): EvidenceIssue[] {
  const issues: EvidenceIssue[] = [];
  const push = (c: ActionCandidate, gate: EvidenceIssue['gate'], message: string, severity?: EvidenceIssue['severity']) =>
    issues.push({ gate, candidateId: c.id, message, severity: severity ?? (FATAL_GATES.has(gate) ? 'fatal' : 'warning') });

  const segments = new Map(segmentText(originalText).map((s) => [s.id, s.text]));
  const textNorm = normalizeForMatch(originalText);

  for (const c of candidates) {
    const quote = (c.evidenceQuote || '').trim();

    // Gate 1: evidence_not_found — quote must exist and appear somewhere in the text
    if (normalizeForMatch(quote).length < 5) {
      push(c, 'evidence_not_found', `Tidak ada kutipan bukti untuk kandidat "${c.title}"`);
    } else if (!quoteIn(quote, originalText)) {
      push(c, 'evidence_not_found', `Kutipan bukti tidak ditemukan dalam teks asli: "${quote}"`);
    } else if (/^seg-\d+$/.test(c.sourceSegmentId)) {
      // Gate 2: source_segment_mismatch — quote should be in the cited segment.
      // Present elsewhere in the text → warning only (LLMs often miscount segments).
      const seg = segments.get(c.sourceSegmentId);
      if (!seg || !quoteIn(quote, seg)) {
        push(
          c,
          'source_segment_mismatch',
          seg
            ? `Kutipan bukti tidak berada di segmen ${c.sourceSegmentId}, tetapi ada di bagian lain teks.`
            : `Segmen ${c.sourceSegmentId} tidak ada; kutipan ditemukan di bagian lain teks.`
        );
      }
    }

    // Gate 3: owner_unknown — owner must resolve to the Contact table (ambiguous names are
    // fine, the clarifier asks). Not a contact → nobody to assign/notify → fatal.
    const owner = (c.owner || '').trim();
    if (!owner) {
      push(c, 'owner_unknown', `Kandidat "${c.title}" tidak memiliki penanggung jawab`);
    } else if (matchContactsByName(contacts, owner).length === 0) {
      const parts = normalizeForMatch(owner.replace(/^(Pak|Bu|Bapak|Ibu)\s+/i, ''))
        .split(' ')
        .filter((p) => p.length > 2);
      const inText = parts.some((p) => ` ${textNorm} `.includes(` ${p} `));
      push(
        c,
        'owner_unknown',
        inText
          ? `Pemilik "${owner}" disebut di teks tetapi tidak ada di daftar kontak`
          : `Pemilik "${owner}" tidak ada di daftar kontak maupun teks rapat`
      );
    }

    // Gate 4: deadline_invalid — YYYY-MM-DD that is a real date; HH:MM in range
    if (c.dueDate && !isValidDate(c.dueDate)) {
      push(c, 'deadline_invalid', `Tanggal jatuh tempo tidak valid: "${c.dueDate}"`);
    }
    if (c.dueTime && !/^([01]\d|2[0-3]):[0-5]\d$/.test(c.dueTime)) {
      push(c, 'deadline_invalid', `Jam tidak valid: "${c.dueTime}"`);
    }
  }

  // Gate 5: duplicate — same title+owner, or same action+owner+quote; first one is kept
  const seen = new Map<string, string>();
  for (const c of candidates) {
    const owner = normalizeForMatch(c.owner || '');
    const keys = [
      `t|${normalizeForMatch(c.title)}|${owner}`,
      `q|${c.actionType}|${owner}|${normalizeForMatch(c.evidenceQuote || '')}`,
    ];
    const first = keys.map((k) => seen.get(k)).find(Boolean);
    if (first) {
      push(c, 'duplicate', `Duplikat kandidat ${first}: ${c.title} (${c.owner})`);
    } else {
      keys.forEach((k) => seen.set(k, c.id));
    }
  }

  return issues;
}

/**
 * Run the gates and split candidates: any fatal issue → rejected with reason codes.
 */
export function applyEvidenceGates(
  candidates: ActionCandidate[],
  originalText: string,
  contacts: EvidenceContact[] = []
): EvidenceResult {
  const issues = validateEvidence(candidates, originalText, contacts);
  const accepted: ActionCandidate[] = [];
  const rejected: RejectedCandidate[] = [];

  for (const c of candidates) {
    const fatal = issues.filter((i) => i.candidateId === c.id && i.severity === 'fatal');
    if (fatal.length === 0) {
      accepted.push(c);
      continue;
    }
    rejected.push({
      id: c.id,
      title: c.title,
      owner: c.owner,
      evidenceQuote: c.evidenceQuote,
      reasons: [...new Set(fatal.map((i) => i.gate))],
      messages: fatal.map((i) => i.message),
    });
  }

  return { accepted, rejected, issues };
}

function isValidDate(value: string): boolean {
  const m = value.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return false;
  const d = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]));
  return d.getUTCFullYear() === +m[1] && d.getUTCMonth() === +m[2] - 1 && d.getUTCDate() === +m[3];
}
