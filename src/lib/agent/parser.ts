import { getLLMProviderAsync } from '@/lib/llm';
import { ParserOutputSchema, type ParserOutput } from './types';
import { segmentText, formatSegments } from './output-guard/segmenter';

const SYSTEM_PROMPT = `Anda adalah parser AI untuk catatan rapat berbahasa Indonesia. 
Tugas: ekstrak SEMUA tindakan (action items) yang disebutkan dalam teks rapat.

Untuk setiap tindakan, identifikasi:
- id: format "cand-NN" (cand-01, cand-02, dst.)
- title: deskripsi singkat tindakan (bahasa Indonesia)
- owner: nama orang yang bertanggung jawab (dari teks)
- dueDate: tanggal jatuh tempo format YYYY-MM-DD (jika disebut)
- dueTime: jam format HH:MM (jika disebut)
- location: lokasi (jika disebut)
- commitmentStatus: salah satu dari:
  - "accepted": komitmen jelas ("Budi akan kirim email besok")
  - "suggestion": saran/mungkin ("sebaiknya kirim pengingat")
  - "vague": tidak spesifik ("perlu follow up")
  - "question": pertanyaan ("siapa yang kirim?")
- evidenceQuote: kutipan VERBATIM (salin persis, tanpa parafrase) dari satu segmen, max 200 karakter
- sourceSegmentId: id segmen tempat kutipan diambil, persis seperti label [seg-NN] di teks
- actionType: salah satu dari: "email", "calendar", "task", "whatsapp"
- recipients: array email/phone penerima (jika ada)
- isExternal: true jika penerima eksternal
- recipientCount: jumlah penerima

Return JSON dengan format: { "candidates": [...] }
HANYA return JSON, tidak ada penjelasan tambahan.`;

export async function parseMeetingText(meetingText: string): Promise<ParserOutput> {
  const llm = await getLLMProviderAsync();

  // Same segmentation the evidence validator uses, so seg ids can be checked
  const prompt = `Teks rapat (tersegmentasi, setiap baris diawali label segmen):
"""
${formatSegments(segmentText(meetingText))}
"""

Ekstrak semua action items dari teks di atas. Return JSON sesuai schema.`;

  return llm.parseJSON(prompt, ParserOutputSchema, SYSTEM_PROMPT);
}
