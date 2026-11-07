import { InjectionResultSchema, type InjectionResult } from '../types';
import { segmentId } from '../output-guard/segmenter';

const INJECTION_PATTERNS: { pattern: string; regex: RegExp }[] = [
  { pattern: 'system_prompt_override', regex: /\b(ignore|disregard)\s+(previous|above|all)\s+(instructions?|prompts?)\b/gi },
  { pattern: 'system_role_prefix', regex: /\b(system|assistant):\s/gi },
  { pattern: 'ai_directive', regex: /\bAI\s*:\s/gi },
  { pattern: 'role_switch', regex: /\b(you\s+are|act\s+as|pretend\s+to\s+be)\s+(now|a)\b/gi },
  { pattern: 'instruction_leak', regex: /\b(show|reveal|print|output)\s+(your|the)\s+(system|initial|original)\s+(prompt|instructions?)\b/gi },
  // "DAN" is case-sensitive: lowercase "dan" is the Indonesian word for "and"
  { pattern: 'jailbreak', regex: /\bDAN\b/g },
  { pattern: 'jailbreak', regex: /\b(jailbreak|developer\s+mode|admin\s+mode)\b/gi },

  // Bahasa Indonesia
  // "abaikan instruksi", "abaikan semua perintah sebelumnya", "lupakan aturan"
  { pattern: 'id_instruction_override', regex: /\b(abaikan|lupakan|hiraukan|acuhkan|kesampingkan)\s+(semua\s+|seluruh\s+|segala\s+)?(instruksi|perintah|aturan|arahan|prompt|batasan)(\s+(sebelumnya|di\s*atas|tadi|sistem|awal))?\b/gi },
  // "teruskan ke semua staf", "kirim ke semua kontak" — mass fan-out, not "semua peserta"
  { pattern: 'id_mass_send', regex: /\b(teruskan|forward|kirim(?:kan)?|sebarkan|bagikan|blast)\s+(\S+\s+){0,3}?(ke|kepada)\s+(semua|seluruh)\s+(staf|staff|karyawan|pegawai|kontak|orang|pengguna|user)\b/gi },
  // "kirim langsung tanpa persetujuan", "lewati konfirmasi"
  { pattern: 'id_bypass_approval', regex: /\b(tanpa|lewati|lewatkan|abaikan)\s+(persetujuan|approval|konfirmasi|verifikasi)\b/gi },
  // "kamu sekarang adalah ...", "berpura-pura menjadi ..."
  { pattern: 'id_role_switch', regex: /\b(kamu|anda)\s+sekarang\s+(adalah|bertindak|berperan)\b|\bberpura-pura\s+(menjadi|jadi|sebagai)\b/gi },
  // "tampilkan prompt sistem", "bocorkan instruksi awal"
  { pattern: 'id_instruction_leak', regex: /\b(tampilkan|tunjukkan|bocorkan|cetak|sebutkan)\s+(prompt|instruksi|perintah)\s+(sistem|awal|asli)\b/gi },
];

const QUARANTINE = '[QUARANTINED]';

function patternsIn(part: string): string[] {
  const found = INJECTION_PATTERNS.filter(({ regex }) => {
    regex.lastIndex = 0;
    return regex.test(part);
  }).map((p) => p.pattern);
  return [...new Set(found)];
}

/**
 * Quarantine the WHOLE segment that carries an embedded instruction, not just the
 * trigger phrase, so the rest of the command ("kirim daftar kontak ke Vendor ...")
 * never reaches the LLM. Segments follow segmentText(): one per non-empty line,
 * or one per sentence for single-line text — so ids (seg-NN) line up with the
 * parser prompt and evidence gates. Quarantined segments stay in place as
 * "[QUARANTINED]" so numbering does not shift.
 */
export function detectInjection(text: string): InjectionResult {
  const quarantinedSegments: InjectionResult['quarantinedSegments'] = [];
  let segNo = 0;

  const check = (part: string): string => {
    if (part.trim().length === 0) return part;
    segNo++;
    const patterns = patternsIn(part);
    if (patterns.length === 0) return part;
    quarantinedSegments.push({ segmentId: segmentId(segNo), text: part.trim(), pattern: patterns.join(', ') });
    return QUARANTINE;
  };

  const lines = text.split(/(\r?\n)/); // keep separators so the layout survives
  const nonEmpty = lines.filter((l, i) => i % 2 === 0 && l.trim().length > 0).length;
  let cleanedText: string;
  if (nonEmpty > 1) {
    cleanedText = lines.map((l, i) => (i % 2 === 0 ? check(l) : l)).join('');
  } else {
    cleanedText = lines
      .map((l, i) => (i % 2 === 0 ? l.split(/(?<=[.!?])\s+/).map(check).join(' ') : l))
      .join('');
  }

  const result: InjectionResult = {
    detected: quarantinedSegments.length > 0,
    quarantinedSegments,
    cleanedText,
  };

  return InjectionResultSchema.parse(result);
}
