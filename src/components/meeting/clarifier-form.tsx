'use client';

import { useMemo, useState } from 'react';
import { parseDateAnswer } from '@/lib/agent/time-hints';
import { formatDateId } from './format';

export interface ClarifierOption {
  value: string;
  label: string;
  // contact_ambiguity extras (optional: older plans only have value/label)
  role?: string | null;
  department?: string | null;
  timezone?: string | null;
  location?: string | null;
}

export interface ClarifierQuestionData {
  id: string;
  type: 'contact_ambiguity' | 'timezone_reference' | 'vague_commitment' | 'missing_due_date';
  candidateId: string;
  /** Contact questions are asked once per name and apply to every action listed here */
  candidateIds?: string[];
  /** Titles of those actions */
  appliesTo?: string[];
  question: string;
  options?: ClarifierOption[];
  required: boolean;
}

interface ClarifierFormProps {
  meetingId: string;
  questions: ClarifierQuestionData[];
  onAnswered: () => void;
}

type FormError = { kind: 'date' | 'permission' | 'other'; title: string; message: string };

/** "Budi Santoso (Manager, Operations)" -> name + "Manager, Operations" when the option has no structured fields */
function contactParts(opt: ClarifierOption) {
  const m = /^(.*?)\s*\(([^)]*)\)\s*$/.exec(opt.label);
  const name = m ? m[1] : opt.label;
  const job = [opt.role, opt.department].filter(Boolean).join(', ') || (m ? m[2] : '');
  const place = [opt.timezone, opt.location].filter(Boolean).join(' ');
  return { name, job, place };
}

function DatePreview({ value }: { value: string }) {
  if (!value.trim()) return null;
  const hint = parseDateAnswer(value);
  if (hint.conflict) {
    return (
      <span className="inline-flex items-center rounded-lg bg-warning-soft px-2.5 py-1.5 text-[13px] text-warning">
        Dua tanggal berbeda — tulis satu saja
      </span>
    );
  }
  if (!hint.dueDate) {
    return (
      <span className="inline-flex items-center rounded-lg bg-warning-soft px-2.5 py-1.5 text-[13px] text-warning">
        Belum terbaca
      </span>
    );
  }
  return (
    <span className="inline-flex items-center rounded-lg bg-success-soft px-2.5 py-1.5 text-[13px] text-success" aria-live="polite">
      Terbaca: {formatDateId(hint.dueDate)}
      {hint.dueTime ? ` · ${hint.dueTime} WIB` : ''}
    </span>
  );
}

export function ClarifierForm({ meetingId, questions, onAnswered }: ClarifierFormProps) {
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<FormError | null>(null);

  // A date answer only counts when it reads as exactly one date (same rule the server applies)
  const dateState = useMemo(() => {
    const out: Record<string, { ok: boolean; conflict?: string }> = {};
    for (const q of questions) {
      if (q.type !== 'missing_due_date' || q.options?.length) continue;
      const v = (answers[q.id] || '').trim();
      if (!v) continue;
      const hint = parseDateAnswer(v);
      out[q.id] = { ok: !!hint.dueDate && !hint.conflict, conflict: hint.conflict };
    }
    return out;
  }, [answers, questions]);

  if (questions.length === 0) return null;

  const required = questions.filter((q) => q.required !== false);
  const answeredCount = questions.filter((q) => (answers[q.id] || '').trim() && dateState[q.id]?.ok !== false).length;
  const allAnswered = required.every((q) => (answers[q.id] || '').trim() && dateState[q.id]?.ok !== false);

  async function handleSubmit() {
    if (!allAnswered) {
      setError({ kind: 'other', title: 'Belum lengkap', message: 'Semua pertanyaan wajib dijawab dulu.' });
      return;
    }

    setSubmitting(true);
    setError(null);

    try {
      const answerArray = Object.entries(answers)
        .filter(([, value]) => value.trim())
        .map(([questionId, value]) => {
          const q = questions.find((x) => x.id === questionId);
          const option = q?.options?.find((o) => o.value === value);
          return { questionId, value: value.trim(), label: option?.label };
        });

      const res = await fetch('/api/agent/clarify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ meetingId, answers: answerArray }),
      });

      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        const unanswered: string[] = Array.isArray(data.unanswered) ? data.unanswered : [];
        const dateQuestion = unanswered.some((id) => questions.find((q) => q.id === id)?.type === 'missing_due_date');
        if (data.code === 'DATE_UNPARSEABLE' || (res.status === 400 && dateQuestion)) {
          setError({ kind: 'date', title: 'Tanggal tidak terbaca', message: data.error || 'Tulis satu tanggal, misalnya "5 November 2026".' });
        } else if (res.status === 403) {
          setError({ kind: 'permission', title: 'Izin tidak cukup', message: data.error || 'Anda tidak boleh menjawab klarifikasi rencana ini.' });
        } else {
          setError({ kind: 'other', title: 'Jawaban belum tersimpan', message: data.error || 'Gagal menyimpan jawaban.' });
        }
        return;
      }

      onAnswered();
    } catch {
      setError({ kind: 'other', title: 'Koneksi terputus', message: 'Jawaban belum tersimpan. Coba kirim lagi.' });
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <section aria-labelledby="clarifier-title" className="flex flex-col gap-4 rounded-[14px] border border-lontar-border bg-white px-5 py-[18px]">
      <div className="flex flex-wrap items-center gap-2">
        <span className="rounded-md bg-clarify-soft px-2 py-[3px] text-[11px] font-bold tracking-[0.04em] text-clarify">KLARIFIKASI</span>
        <h2 id="clarifier-title" className="m-0 text-[15px] font-semibold">
          {required.length} pertanyaan wajib dijawab sebelum approve
        </h2>
      </div>

      {questions.map((q, idx) => {
        const n = `${idx + 1}. `;
        if (q.options && q.options.length > 0) {
          return (
            <fieldset key={q.id} className="m-0 flex flex-col gap-2 border-0 p-0">
              <legend className="mb-2 p-0 text-sm font-medium">
                {n}
                {q.question}
                <span className="ml-2 text-xs font-normal text-lontar-mute">({(q.candidateIds?.length ? q.candidateIds : [q.candidateId]).join(', ')})</span>
                {(q.appliesTo?.length ?? 0) > 1 && (
                  <span className="mt-1 block text-xs font-normal text-lontar-mute">Berlaku untuk: {q.appliesTo!.join(' · ')}</span>
                )}
              </legend>
              <div className="flex flex-wrap gap-2">
                {q.options.map((opt) => {
                  const selected = answers[q.id] === opt.value;
                  const contact = q.type === 'contact_ambiguity' ? contactParts(opt) : null;
                  return (
                    <label
                      key={opt.value}
                      className={`flex min-h-[44px] cursor-pointer items-center gap-2.5 rounded-lg bg-white py-2 text-[13px] transition-colors ${
                        selected ? 'border-2 border-clarify px-[13px]' : 'border border-lontar-input px-3.5 hover:border-clarify/60'
                      }`}
                    >
                      <input
                        type="radio"
                        name={q.id}
                        value={opt.value}
                        checked={selected}
                        onChange={() => setAnswers((prev) => ({ ...prev, [q.id]: opt.value }))}
                        className="h-4 w-4 accent-[hsl(var(--clarify))]"
                      />
                      {contact ? (
                        <span>
                          <strong>{contact.name}</strong>
                          {contact.job && <> · {contact.job}</>}
                          {contact.place && <> · {contact.place}</>}
                        </span>
                      ) : (
                        <span>{opt.label}</span>
                      )}
                    </label>
                  );
                })}
              </div>
            </fieldset>
          );
        }

        const inputId = `clarify-${q.id}`;
        const hintId = `${inputId}-hint`;
        const isDate = q.type === 'missing_due_date';
        return (
          <div key={q.id} className="flex flex-col gap-1.5">
            <label htmlFor={inputId} className="text-sm font-medium">
              {n}
              {q.question}
              <span className="ml-2 text-xs font-normal text-lontar-mute">({(q.candidateIds?.length ? q.candidateIds : [q.candidateId]).join(', ')})</span>
                {(q.appliesTo?.length ?? 0) > 1 && (
                  <span className="mt-1 block text-xs font-normal text-lontar-mute">Berlaku untuk: {q.appliesTo!.join(' · ')}</span>
                )}
            </label>
            <div className="flex flex-wrap items-center gap-2">
              <input
                id={inputId}
                type="text"
                value={answers[q.id] || ''}
                onChange={(e) => setAnswers((prev) => ({ ...prev, [q.id]: e.target.value }))}
                aria-describedby={isDate ? hintId : undefined}
                aria-invalid={dateState[q.id]?.ok === false ? true : undefined}
                className="min-h-[40px] flex-[1_1_260px] rounded-lg border border-lontar-input bg-white px-3 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                placeholder={isDate ? 'mis. besok, Jumat, 5 November 2026' : 'Tulis jawaban…'}
              />
              {isDate && <DatePreview value={answers[q.id] || ''} />}
            </div>
            {isDate && (
              <span id={hintId} className="text-xs text-lontar-mute">
                Boleh “besok”, “lusa”, nama hari, “5 November 2026” atau 5/11/2026. Jawaban yang menyebut dua tanggal berbeda ditolak.
              </span>
            )}
            {dateState[q.id]?.conflict && <span className="text-xs text-warning">{dateState[q.id]?.conflict}</span>}
          </div>
        );
      })}

      {error && (
        <div
          role="alert"
          className={`flex flex-col gap-1 rounded-[14px] border bg-white px-4 py-3 ${
            error.kind === 'date' ? 'border-lontar-warnLine' : 'border-lontar-dangerLine'
          }`}
        >
          <strong className={`text-sm ${error.kind === 'date' ? 'text-warning' : 'text-destructive'}`}>{error.title}</strong>
          <span className="text-[13px] text-secondary-foreground/80">{error.message}</span>
        </div>
      )}

      <div className="flex flex-wrap items-center gap-3 border-t border-lontar-line pt-3">
        <button
          type="button"
          onClick={handleSubmit}
          disabled={!allAnswered || submitting}
          className="min-h-[40px] rounded-lg border border-clarify bg-white px-3.5 text-[13px] font-semibold text-clarify hover:bg-clarify-soft disabled:cursor-not-allowed disabled:border-lontar-input disabled:text-lontar-mute disabled:hover:bg-white"
        >
          {submitting ? 'Menyimpan…' : 'Simpan jawaban'}
        </button>
        <span className="text-xs text-lontar-mute">
          {answeredCount}/{questions.length} terjawab · jawaban mengubah penerima/jatuh tempo, lalu rencana dimuat ulang untuk di-review.
        </span>
      </div>
    </section>
  );
}
