import { sha256 } from '@/lib/utils/crypto';
import { NotulenSchema, type Notulen, type ActionCandidate } from './types';

export function generateNotulen(
  title: string,
  meetingText: string,
  participants: string[],
  candidates: ActionCandidate[],
  openCandidates: ActionCandidate[] = []
): Notulen {
  // Extract agenda from text (simple heuristic — lines with bullet points or "agenda")
  const lines = meetingText.split('\n').filter((l) => l.trim().length > 0);
  const agenda: string[] = [];
  for (const line of lines) {
    if (/^[-*•]\s/.test(line.trim()) || /^\d+\.\s/.test(line.trim())) {
      agenda.push(line.trim().replace(/^[-*•]\s+|^\d+\.\s+/, ''));
    }
  }
  if (agenda.length === 0 && lines.length > 0) {
    agenda.push(lines[0].trim());
  }

  // Extract decisions (lines with "diputuskan", "disepakati", "keputusan")
  const keputusan: string[] = [];
  for (const line of lines) {
    const lower = line.toLowerCase();
    if (lower.includes('diputuskan') || lower.includes('disepakati') || lower.includes('keputusan') || lower.includes('disetujui')) {
      keputusan.push(line.trim());
    }
  }
  if (keputusan.length === 0) {
    keputusan.push('Tidak ada keputusan formal yang tercatat.');
  }

  // Pembahasan: full text (cleaned)
  const pembahasan = meetingText.trim();

  // Action items: firm commitments only (callers may still pass mixed lists)
  const actionItems = candidates
    .filter((c) => c.commitmentStatus === 'accepted')
    .map((c) => ({
      id: c.id,
      title: c.title,
      owner: c.owner,
      dueDate: c.dueDate,
    }));

  // Open items: suggestions, vague commitments and questions — recorded, never executed
  const open_items = [...candidates, ...openCandidates]
    .filter((c) => c.commitmentStatus !== 'accepted')
    .map((c) => ({
      id: c.id,
      title: c.title,
      owner: c.owner || undefined,
      status: c.commitmentStatus as 'suggestion' | 'vague' | 'question',
      evidenceQuote: c.evidenceQuote,
    }));

  // Generate hash for tanda tangan digital
  const notulenData = {
    judul: title,
    tanggal: formatTanggalID(new Date()),
    peserta: participants,
    agenda,
    pembahasan,
    keputusan,
    actionItems,
    open_items,
  };
  const hash = sha256(JSON.stringify(notulenData));

  return NotulenSchema.parse({
    ...notulenData,
    hash,
  });
}

const HARI = ['Minggu', 'Senin', 'Selasa', 'Rabu', 'Kamis', 'Jumat', 'Sabtu'];
const BULAN = ['Januari', 'Februari', 'Maret', 'April', 'Mei', 'Juni', 'Juli', 'Agustus', 'September', 'Oktober', 'November', 'Desember'];

/**
 * "Selasa, 3 November 2026" in WIB (UTC+7). Manual tables so output does not depend on ICU data.
 */
export function formatTanggalID(date: Date): string {
  const wib = new Date(date.getTime() + 7 * 60 * 60 * 1000);
  return `${HARI[wib.getUTCDay()]}, ${wib.getUTCDate()} ${BULAN[wib.getUTCMonth()]} ${wib.getUTCFullYear()}`;
}
