import { getLLMProviderAsync } from '@/lib/llm';
import { ValidatorResultSchema, type ValidatorResult, type ActionCandidate } from './types';

const SYSTEM_PROMPT = `Anda adalah validator AI (LLM kedua). Tugas Anda adalah cross-check rencana aksi terhadap permintaan asli.
Verifikasi:
1. Apakah setiap kandidat aksi BENAR-BENAR ada dalam teks asli?
2. Apakah ada permintaan yang TIDAK ter-cover oleh kandidat?
3. Apakah ada miskonsepsi atau distorsi?

Return JSON: { "matches": ["cand-01", ...], "mismatches": ["cand-03", ...], "warnings": ["...", ...] }
- matches: kandidat yang valid dan akurat
- mismatches: kandidat yang tidak akurat atau tidak ada dalam teks asli
- warnings: catatan tambahan`;

export async function validatePlan(
  candidates: ActionCandidate[],
  originalText: string
): Promise<ValidatorResult> {
  try {
    const llm = await getLLMProviderAsync();
    const prompt = `Teks rapat asli:
"""
${originalText}
"""

Rencana kandidat aksi:
${JSON.stringify(candidates, null, 2)}

Cross-check rencana terhadap teks asli. Return JSON hasil validasi.`;

    const raw = await llm.parseJSON(prompt, ValidatorResultSchema, SYSTEM_PROMPT);
    return normalizeResult(raw, candidates);
  } catch (error) {
    // Safe default: an unavailable validator does NOT vouch for any candidate
    console.error('[Validator] LLM error:', error instanceof Error ? error.message : error);
    return ValidatorResultSchema.parse({
      matches: [],
      mismatches: [],
      warnings: ['Validator tidak tersedia — kandidat belum diverifikasi silang.'],
    });
  }
}

/**
 * Keep only known candidate ids; a mismatch wins over a match; candidates the
 * LLM skipped are reported as a warning instead of silently counted as valid.
 */
function normalizeResult(raw: ValidatorResult, candidates: ActionCandidate[]): ValidatorResult {
  const ids = new Set(candidates.map((c) => c.id));
  const mismatches = [...new Set(raw.mismatches.filter((id) => ids.has(id)))];
  const matches = [...new Set(raw.matches.filter((id) => ids.has(id) && !mismatches.includes(id)))];
  const unchecked = candidates.map((c) => c.id).filter((id) => !matches.includes(id) && !mismatches.includes(id));
  const warnings = [...raw.warnings];
  if (unchecked.length > 0) warnings.push(`Tidak diverifikasi validator: ${unchecked.join(', ')}`);
  return { matches, mismatches, warnings };
}
