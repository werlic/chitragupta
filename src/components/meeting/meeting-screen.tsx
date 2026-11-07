'use client';

// Meeting screen (canvas Meeting.dc.html): "Proses teks rapat" form + "Meeting terakhir"
import { useEffect, useState } from 'react';
import Link from 'next/link';
import type { Role } from '@prisma/client';
import { can } from '@/lib/auth/rbac';
import { useAuthStore } from '@/stores/auth-store';
import { ScreenHeader, StatusChip } from '@/components/shell/lontar';
import { MeetingInputForm } from './input-form';
import { timeAgo } from './format';

interface MeetingRow {
  id: string;
  title: string;
  status: string;
  createdAt: string;
  creator?: { name: string } | null;
  _count?: { candidates?: number };
}

export function MeetingScreen() {
  const { user } = useAuthStore();
  // Directors and Managers see every meeting; only roles with meeting:create start one
  const canCreate = !!user && can(user.role as Role, 'meeting:create');
  const [meetings, setMeetings] = useState<MeetingRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch('/api/meetings')
      .then(async (r) => {
        const d = await r.json().catch(() => ({}));
        if (!r.ok) throw new Error(d.error || 'Daftar meeting gagal dimuat.');
        setMeetings(Array.isArray(d.meetings) ? d.meetings : []);
      })
      .catch((e: Error) => setError(e.message))
      .finally(() => setLoading(false));
  }, []);

  return (
    <>
      <ScreenHeader crumbs={[{ label: 'Meeting' }]} />
      <main className="mx-auto flex max-w-[1200px] flex-wrap items-start gap-6 px-8 py-6 max-sm:px-4">
        <h1 className="sr-only">Meeting</h1>
        {canCreate && <MeetingInputForm />}
        <section className={`overflow-hidden rounded-2xl border border-lontar-border bg-white ${canCreate ? 'flex-[1_1_320px]' : 'flex-1'}`}>
          <h2 className="m-0 border-b border-lontar-line px-5 py-4 text-[15px] font-semibold">Meeting terakhir</h2>
          {loading ? (
            <p className="m-0 px-5 py-4 text-[13px] text-lontar-mute">Memuat…</p>
          ) : error ? (
            <p role="alert" className="m-0 px-5 py-4 text-[13px] text-destructive">
              {error}
            </p>
          ) : meetings.length === 0 ? (
            <p className="m-0 px-5 py-4 text-[13px] text-lontar-mute">Belum ada meeting. Tempel teks rapat di chat atau di formulir ini.</p>
          ) : (
            <ul className="m-0 max-h-[640px] list-none overflow-y-auto p-0">
              {meetings.map((m) => (
                <li key={m.id} className="border-b border-lontar-line last:border-b-0">
                  <Link
                    href={`/dashboard/meetings/${m.id}`}
                    className="flex items-center gap-2 px-5 py-3 text-sm text-lontar-text no-underline hover:bg-lontar-head hover:text-lontar-text"
                  >
                    <span className="flex min-w-0 flex-1 flex-col">
                      <span className="truncate font-medium">{m.title}</span>
                      <span className="text-xs text-lontar-mute">
                        {[m.creator?.name && `oleh ${m.creator.name}`, timeAgo(m.createdAt), m._count?.candidates != null && `${m._count.candidates} aksi`]
                          .filter(Boolean)
                          .join(' · ')}
                      </span>
                    </span>
                    <StatusChip status={m.status} dot={false} className="ml-auto shrink-0 py-[3px]" />
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </section>
      </main>
    </>
  );
}
