'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { AlertCircle } from 'lucide-react';

const SAMPLE_TEXT = `Rapat Koordinasi Bulanan — 27 Oktober 2026

Peserta: Budi Santoso (Manager), Sari Wijaya (Secretary), Budi Hartono (Staff)

Agenda:
1. Evaluasi kinerja Q3
2. Persiapan audit tahunan
3. Penjadwalan training tim

Pembahasan:
- Budi Santoso akan kirim email undangan rapat audit ke Budi Hartono besok jam 9 pagi.
- Sari Wijaya akan jadwalkan rapat evaluasi kuartal pada tanggal 31 Oktober jam 2 siang di Ruang Rapat A.
- Mungkin perlu kirim pengingat WhatsApp ke Budi Hartono sehari sebelum audit.
- Budi Hartono akan siapkan dokumen keuangan untuk audit.

Keputusan: Audit akan dilaksanakan minggu depan. Dokumen harus siap paling lambat Jumat.`;

export function MeetingInputForm() {
  const router = useRouter();
  const [title, setTitle] = useState('');
  const [text, setText] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [participants, setParticipants] = useState('');
  // The pipeline logs CONSENT_LOGGED for every processed text; the box makes the user confirm it first
  const [consent, setConsent] = useState(false);
  // State C (canvas States): the parser could not read the text; retry sends the SAME body again
  const [parserFailed, setParserFailed] = useState<{ body: string; message: string; meetingId?: string; retryable: boolean } | null>(null);

  async function send(body: string) {
    setError('');
    setLoading(true);
    try {
      const res = await fetch('/api/agent/process', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body,
      });

      const data = await res.json().catch(() => ({}));
      if (res.ok && data.meetingId) {
        setParserFailed(null);
        router.push(`/dashboard/meetings/${data.meetingId}`);
        return;
      }
      if (data.code === 'PARSER_FAILED' || res.status === 422) {
        setParserFailed({
          body,
          message: data.error || 'Model AI gagal menyusun kandidat.',
          meetingId: data.meetingId,
          retryable: data.retryable !== false,
        });
      } else if (res.status === 403) {
        setParserFailed(null);
        setError(data.error || 'Anda tidak memiliki izin untuk membuat meeting.');
      } else {
        setParserFailed(null);
        setError(data.error || 'Gagal memproses meeting.');
      }
    } catch {
      setError('Koneksi terputus. Teks belum diproses; coba kirim lagi.');
    } finally {
      setLoading(false);
    }
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!consent) {
      setError('Centang persetujuan peserta dulu.');
      return;
    }
    if (text.trim().length < 10) {
      setError('Teks rapat minimal 10 karakter');
      return;
    }
    await send(
      JSON.stringify({
        title: title || undefined,
        text,
        participants: participants ? participants.split(',').map((p) => p.trim()).filter(Boolean) : undefined,
      })
    );
  }

  const field = 'min-h-[44px] rounded-lg border border-lontar-input bg-white px-3 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring';

  return (
    <form
      onSubmit={handleSubmit}
      className="flex min-w-0 flex-[999_1_520px] flex-col gap-3.5 rounded-2xl border border-lontar-border bg-white p-5"
    >
      <h2 className="m-0 text-lg font-bold">Proses teks rapat</h2>
      <div className="flex flex-col gap-1.5">
        <label htmlFor="title" className="text-[13px] font-semibold">
          Judul
        </label>
        <input id="title" type="text" placeholder="Rapat koordinasi mingguan" value={title} onChange={(e) => setTitle(e.target.value)} className={field} />
      </div>
      <div className="flex flex-col gap-1.5">
        <label htmlFor="participants" className="text-[13px] font-semibold">
          Peserta
        </label>
        <input
          id="participants"
          type="text"
          placeholder="Sari Wijaya, Dewi Lestari, Budi Santoso"
          value={participants}
          onChange={(e) => setParticipants(e.target.value)}
          className={field}
        />
      </div>
      <div className="flex flex-col gap-1.5">
        <div className="flex items-center justify-between gap-2">
          <label htmlFor="text" className="text-[13px] font-semibold">
            Notulen atau export chat WA
          </label>
          <button type="button" onClick={() => setText(SAMPLE_TEXT)} className="min-h-[32px] px-1 text-xs text-primary hover:underline">
            Isi contoh
          </button>
        </div>
        <textarea
          id="text"
          rows={9}
          value={text}
          onChange={(e) => setText(e.target.value)}
          required
          placeholder="[03/11/26 10:06] Sari Wijaya: Tolong kirim notulen ke Pak Budi ya"
          className="resize-y rounded-lg border border-lontar-input bg-white px-3 py-2.5 text-sm leading-[1.55] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        />
        <span className="text-xs text-lontar-mute">
          {text.length} karakter · data pribadi disamarkan otomatis · instruksi tertanam dikarantina
        </span>
      </div>
      <label className="flex min-h-[44px] items-center gap-2.5 text-[13px] text-lontar-sub">
        <input id="consent" type="checkbox" checked={consent} onChange={(e) => setConsent(e.target.checked)} className="h-4 w-4 accent-[#3B3FB6]" required />
        Peserta setuju teks ini diproses (consent tercatat di audit log, retensi 5 tahun sesuai UU PDP)
      </label>

      {error && (
        <div role="alert" className="flex items-center gap-2 rounded-lg bg-destructive-soft px-3 py-2.5 text-[13px] text-destructive">
          <AlertCircle className="h-4 w-4 shrink-0" aria-hidden="true" />
          {error}
        </div>
      )}

      {parserFailed && (
        <div role="alert" className="flex flex-col gap-1.5 rounded-[14px] border border-lontar-border bg-white p-4">
          <strong className="text-sm">Agent tidak bisa membaca teks ini</strong>
          <span className="text-[13px] text-lontar-sub">
            {parserFailed.message} Belum ada aksi yang dibuat; rapat tidak ditinggal di status “Memproses”.
          </span>
          <div className="flex flex-wrap items-center gap-3">
            {parserFailed.retryable && (
              <button
                type="button"
                disabled={loading}
                onClick={() => send(parserFailed.body)}
                className="min-h-[40px] rounded-lg border border-lontar-border bg-white px-3.5 text-[13px] hover:bg-lontar-head disabled:opacity-60"
              >
                {loading ? 'Mencoba lagi…' : 'Coba lagi'}
              </button>
            )}
            {parserFailed.meetingId && (
              <a href={`/dashboard/meetings/${parserFailed.meetingId}`} className="inline-flex min-h-[40px] items-center text-[13px] text-primary hover:underline">
                Lihat rapat yang gagal
              </a>
            )}
          </div>
        </div>
      )}

      <div className="flex flex-wrap items-center gap-2">
        <button
          type="submit"
          disabled={loading || !consent}
          className="min-h-[44px] rounded-lg bg-primary px-[18px] text-sm font-semibold text-white hover:bg-nila-700 disabled:cursor-not-allowed disabled:bg-lontar-disabled"
        >
          {loading ? 'Menyusun rencana…' : 'Susun rencana'}
        </button>
        <span className="text-xs text-lontar-mute">Hasilnya rencana yang menunggu approval, bukan aksi.</span>
      </div>
    </form>
  );
}
