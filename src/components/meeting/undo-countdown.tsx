'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';

export interface ExecutionRef {
  candidateId: string;
  executionId: string;
  undoDeadline: number;
}

const WINDOW_MS = 60_000;

/** "14:02 WIB" */
export function wibClock(value?: string | number | Date | null): string {
  const d = value ? new Date(value) : new Date();
  if (Number.isNaN(d.getTime())) return '';
  return `${d.toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit', hour12: false, timeZone: 'Asia/Jakarta' }).replace('.', ':')} WIB`;
}

type FinalKind = 'undone' | 'expired' | 'partial';

/** Settled states after the undo window (canvas States A): stays on screen, also after reload */
export function ExecutionStatusCard({
  kind,
  count,
  undoneCount,
  executedAt,
  note,
}: {
  kind: FinalKind;
  count: number;
  undoneCount?: number;
  executedAt?: string | number | Date | null;
  note?: string;
}) {
  if (kind === 'undone') {
    return (
      <div role="status" className="flex flex-col gap-2 rounded-[14px] border border-lontar-border bg-white p-4">
        <span className="self-start rounded-full bg-lontar-muted px-2.5 py-1 text-xs font-semibold text-lontar-sub">Dibatalkan</span>
        <p className="text-sm">
          Undo berhasil. {count === 2 ? 'Kedua aksi' : count > 2 ? `Semua ${count} aksi` : 'Aksi'} ditandai dibatalkan dan tercatat di audit log (EXECUTION_UNDONE).
        </p>
      </div>
    );
  }
  if (kind === 'partial') {
    return (
      <div role="status" className="flex flex-col gap-2 rounded-[14px] border border-lontar-warnLine bg-white p-4">
        <span className="self-start rounded-full bg-warning-soft px-2.5 py-1 text-xs font-semibold text-warning">Sebagian dibatalkan</span>
        <p className="text-sm">
          {undoneCount ?? 0} dari {count} aksi dibatalkan. Sisanya sudah melewati jendela undo dan tetap dieksekusi.
        </p>
        {note && <p className="text-[13px] text-muted-foreground">{note}</p>}
      </div>
    );
  }
  return (
    <div role="status" className="flex flex-col gap-2 rounded-[14px] border border-lontar-border bg-white p-4">
      <span className="self-start rounded-full bg-success-soft px-2.5 py-1 text-xs font-semibold text-success">Dieksekusi</span>
      <p className="text-sm">
        {count} aksi dijalankan{executedAt ? ` pukul ${wibClock(executedAt)}` : ''}. Jendela undo berakhir — 60 detik sudah lewat.
      </p>
      {note && <p className="text-[13px] text-muted-foreground">{note}</p>}
      <Link href="/dashboard/tasks" className="inline-flex min-h-[44px] items-center self-start text-[13px] text-primary underline-offset-4 hover:underline">
        Lihat di Tugas
      </Link>
    </div>
  );
}

interface UndoCountdownProps {
  executions: ExecutionRef[];
  meetingId: string;
  planHash?: string;
  executedAt?: number;
  /** Called with the execution IDs that were really undone */
  onUndone: (executionIds: string[]) => void;
}

/**
 * One undo window for everything approved in one go (canvas States A).
 * When it closes it stays as a settled card: "Dibatalkan" or "Jendela undo berakhir".
 */
export function UndoCountdown({ executions, meetingId, planHash, executedAt, onUndone }: UndoCountdownProps) {
  const deadline = Math.min(...executions.map((e) => e.undoDeadline));
  const [now, setNow] = useState(Date.now());
  const [undoing, setUndoing] = useState(false);
  const [final, setFinal] = useState<{ kind: FinalKind; undone: number; note?: string } | null>(null);
  const announced = useRef(false);

  useEffect(() => {
    if (final) return;
    const interval = setInterval(() => setNow(Date.now()), 250);
    return () => clearInterval(interval);
  }, [final]);

  const remaining = Math.max(0, deadline - now);
  const seconds = Math.ceil(remaining / 1000);

  useEffect(() => {
    if (!final && remaining <= 0 && !undoing) setFinal({ kind: 'expired', undone: 0 });
  }, [remaining, final, undoing]);

  async function handleUndo() {
    setUndoing(true);
    const undone: string[] = [];
    let lastError = '';
    for (const e of executions) {
      try {
        const res = await fetch('/api/agent/undo', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ executionId: e.executionId, meetingId }),
        });
        if (res.ok) undone.push(e.executionId);
        else lastError = (await res.json().catch(() => ({}))).error || 'Undo ditolak server.';
      } catch {
        lastError = 'Koneksi terputus saat undo.';
      }
    }
    setUndoing(false);
    if (undone.length === executions.length) setFinal({ kind: 'undone', undone: undone.length });
    else if (undone.length > 0) setFinal({ kind: 'partial', undone: undone.length, note: lastError });
    else setFinal({ kind: 'expired', undone: 0, note: lastError ? `Undo gagal: ${lastError}` : undefined });
    if (!announced.current && undone.length > 0) {
      announced.current = true;
      onUndone(undone);
    }
  }

  if (final) {
    return (
      <ExecutionStatusCard
        kind={final.kind}
        count={executions.length}
        undoneCount={final.undone}
        executedAt={executedAt}
        note={final.note}
      />
    );
  }

  const percentage = Math.min(100, (remaining / WINDOW_MS) * 100);

  return (
    <div className="flex flex-col gap-3 rounded-[14px] border border-lontar-border bg-white p-4 animate-slide-in">
      <span className="self-start rounded-full bg-success-soft px-2.5 py-1 text-xs font-semibold text-success">
        Disetujui &amp; dijalankan · {executions.length} aksi
      </span>
      <p className="text-sm leading-relaxed">
        Approve langsung menjalankan aksi (mock). Anda masih bisa <strong>undo selama {seconds} detik</strong>.
      </p>
      <div
        role="progressbar"
        aria-label="Sisa waktu undo"
        aria-valuemin={0}
        aria-valuemax={60}
        aria-valuenow={seconds}
        className="h-1.5 overflow-hidden rounded-full bg-lontar-muted"
      >
        <div className="h-1.5 bg-primary transition-[width] duration-200" style={{ width: `${percentage}%` }} />
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={handleUndo}
          disabled={undoing}
          className="min-h-[44px] rounded-lg border border-lontar-text bg-white px-4 text-sm font-semibold transition-colors hover:bg-secondary disabled:opacity-50"
        >
          {undoing ? 'Membatalkan…' : `Undo (${seconds} dtk)`}
        </button>
        {planHash && (
          <span className="font-mono text-xs text-muted-foreground" title={planHash}>
            plan {planHash.slice(0, 4)}…{planHash.slice(-4)}
          </span>
        )}
      </div>
    </div>
  );
}
