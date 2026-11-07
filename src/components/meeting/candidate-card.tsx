'use client';

// One action of the plan on the review screen (canvas Review.dc.html "Aksi 1/2")
import type { ActionCandidate, RuleWarning, EvidenceIssue } from '@/lib/agent/types';
import { convertTime, TIMEZONES, type TimeZone } from '@/lib/utils/timezone';
import { emailBody } from '@/lib/agent/tool-mock/templates';
import { actionTypeOf, formatDateId } from './format';

interface CandidateCardProps {
  candidate: ActionCandidate;
  warnings?: RuleWarning[];
  evidenceIssues?: EvidenceIssue[];
  highImpact?: boolean;
  /** Candidate status in the database (PENDING, REJECTED, EXECUTED, ACCEPTED) */
  serverStatus?: string;
  /** Meeting title, used by the email template ("Terlampir notulen <judul>") */
  meetingTitle?: string | null;
  /** High-impact confirmation checkbox, shown while the action can still be approved */
  confirm?: { checked: boolean; onChange: (v: boolean) => void };
  children?: React.ReactNode;
}

const PILL = 'whitespace-nowrap rounded-md px-2 py-[3px] text-[11px] font-bold tracking-[0.04em]';

interface Recipient {
  name: string;
  email?: string;
  phone?: string;
  timezone?: string;
  location?: string;
  external: boolean;
}

/** Stored recipients are JSON contact snapshots or plain names */
function parse(r: string): Recipient {
  if (typeof r === 'string' && r.startsWith('{')) {
    try {
      const i = JSON.parse(r);
      return {
        name: i.name || i.email || r,
        email: i.email || undefined,
        phone: i.phone || undefined,
        timezone: i.timezone || undefined,
        location: i.location || undefined,
        external: i.isExternal === true,
      };
    } catch {
      // plain string
    }
  }
  return { name: String(r), external: false };
}

const isZone = (z?: string): z is TimeZone => !!z && z in TIMEZONES;

/** Recipients grouped per zone with local time (calendar card) */
function zoneRows(recipients: Recipient[], dueTime: string, dueDate?: string) {
  const groups = new Map<TimeZone, { cities: Set<string>; names: string[] }>();
  for (const r of recipients) {
    if (!isZone(r.timezone)) continue;
    const g = groups.get(r.timezone) ?? { cities: new Set<string>(), names: [] };
    if (r.location) g.cities.add(r.location);
    g.names.push(r.name);
    groups.set(r.timezone, g);
  }
  const short = dueDate ? formatDateId(dueDate).replace(',', '').replace(/ \d{4}$/, '') : '';
  return (['WIB', 'WITA', 'WIT'] as TimeZone[])
    .filter((z) => groups.has(z))
    .map((z) => ({
      zone: z,
      cities: Array.from(groups.get(z)!.cities).join(', ') || '—',
      local: `${short ? `${short} · ` : ''}${convertTime(dueTime, 'WIB', z)}`,
      names: groups.get(z)!.names.join(', '),
    }));
}

/** Preview of what the mock tool sends: email uses the same template as the tool (tool-mock/templates.ts) */
function messagePreview(c: ActionCandidate, meetingTitle?: string | null): { label: string; text: string } | null {
  const t = (c.actionType || '').toLowerCase();
  if (t === 'email') {
    return {
      label: 'Isi pesan',
      text: emailBody({ owner: c.owner, title: c.title, dueDate: c.dueDate, meetingTitle }),
    };
  }
  if (t === 'whatsapp') {
    return {
      label: 'Isi pesan',
      text: `*${c.title}*\n\nHalo, ini pengingat untuk tugas yang ditugaskan kepada ${c.owner}. Jatuh tempo: ${c.dueDate || '-'}.\n\n— Chitragupta`,
    };
  }
  return null;
}

export function CandidateCard({ candidate, warnings = [], evidenceIssues = [], highImpact, serverStatus, meetingTitle, confirm, children }: CandidateCardProps) {
  const type = actionTypeOf(candidate.actionType);
  const kind = (candidate.actionType || '').toLowerCase();
  const myWarnings = warnings.filter((w) => w.candidateId === candidate.id);
  const myIssues = evidenceIssues.filter((e) => e.candidateId === candidate.id);
  const recipients = (candidate.recipients || []).map(parse);
  const count = candidate.recipientCount || recipients.length;
  const zones = candidate.dueTime ? zoneRows(recipients, candidate.dueTime, candidate.dueDate) : [];
  const showZoneTable = zones.length > 1 || (kind === 'calendar' && zones.length > 0);
  const externalRecipients = recipients.filter((r) => r.external);
  const external = candidate.isExternal || externalRecipients.length > 0;
  const preview = messagePreview(candidate, meetingTitle);
  const settled = serverStatus === 'REJECTED' || serverStatus === 'EXECUTED';

  const confirmText =
    kind === 'calendar' ? (
      <>
        Saya paham undangan ini dikirim ke{' '}
        <strong>
          {count} orang di {Math.max(zones.length, 1)} zona waktu
        </strong>
        .
      </>
    ) : externalRecipients.length > 0 ? (
      <>
        Saya paham pesan ini dikirim ke <strong>penerima eksternal</strong> ({externalRecipients.map((r) => r.name).join(', ')}).
      </>
    ) : external ? (
      // Flagged external (the text names an outside party) but no stored recipient is external: don't label internal people as external
      <>Saya paham aksi ini ditandai eksternal (menyebut pihak luar).</>
    ) : (
      <>
        Saya paham pesan ini dikirim ke <strong>{count} orang</strong>.
      </>
    );

  return (
    <section aria-label={`Aksi ${candidate.id}`} className={`overflow-hidden rounded-[14px] border border-lontar-border bg-white ${serverStatus === 'REJECTED' ? 'opacity-70' : ''}`}>
      <div className="flex flex-wrap items-center gap-2 border-b border-lontar-line px-5 py-3.5">
        <span className={`${PILL} ${type.className}`}>{type.label}</span>
        <h3 className="m-0 text-[15px] font-semibold">{candidate.title}</h3>
        {(highImpact || external) && (
          <span className={`${PILL} bg-warning-soft text-warning`}>{external ? 'EKSTERNAL' : `${count} PENERIMA`} · DAMPAK TINGGI</span>
        )}
        <span className="ml-auto text-xs text-lontar-mute">
          {candidate.id}
          {serverStatus ? ` · ${serverStatus}` : ''}
        </span>
      </div>

      {showZoneTable ? (
        <div className="flex flex-col gap-3 px-5 py-3.5 text-[13px]">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[520px] border-collapse">
              <caption className="sr-only">Waktu lokal per zona penerima</caption>
              <thead>
                <tr className="text-left text-xs text-lontar-mute">
                  <th scope="col" className="px-2 py-1.5 font-semibold">Zona</th>
                  <th scope="col" className="px-2 py-1.5 font-semibold">Kota</th>
                  <th scope="col" className="px-2 py-1.5 font-semibold">Waktu lokal</th>
                  <th scope="col" className="px-2 py-1.5 font-semibold">Penerima</th>
                </tr>
              </thead>
              <tbody>
                {zones.map((z) => (
                  <tr key={z.zone} className="border-t border-lontar-line">
                    <td className="p-2">{z.zone}</td>
                    <td className="p-2">{z.cities}</td>
                    <td className="p-2 font-semibold">{z.local}</td>
                    <td className="p-2">{z.names}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <dl className="m-0 grid grid-cols-1 gap-x-4 gap-y-2.5 sm:grid-cols-[160px_minmax(0,1fr)]">
            <dt className="text-lontar-mute">Penyelenggara</dt>
            <dd className="m-0">{candidate.owner}</dd>
            {candidate.location && (
              <>
                <dt className="text-lontar-mute">Lokasi</dt>
                <dd className="m-0">{candidate.location}</dd>
              </>
            )}
            <dt className="text-lontar-mute">Bukti ({candidate.sourceSegmentId})</dt>
            <dd className="m-0 italic text-lontar-sub">“{candidate.evidenceQuote}”</dd>
          </dl>
        </div>
      ) : (
        <dl className="m-0 grid grid-cols-1 gap-x-4 gap-y-2.5 px-5 py-3.5 text-[13px] sm:grid-cols-[160px_minmax(0,1fr)]">
          {(kind === 'task' || recipients.length === 0) && (
            <>
              <dt className="text-lontar-mute">Pemilik tugas</dt>
              <dd className="m-0">{candidate.owner}</dd>
            </>
          )}
          {(recipients.length > 0 || kind !== 'task') && (
            <>
              <dt className="text-lontar-mute">Penerima ({count})</dt>
              <dd className="m-0 flex flex-col gap-1">
                {recipients.length === 0 ? (
                  <span className="text-lontar-mute">—</span>
                ) : (
                  recipients.map((r, i) => (
                    <span key={i}>
                      {r.name}
                      {r.email && <> &lt;{r.email}&gt;</>}
                      {r.phone && <> · {r.phone}</>}
                      {r.timezone && <> · {r.timezone}</>}
                      {r.external && <span className={`${PILL} ml-2 bg-warning-soft text-warning`}>EKSTERNAL</span>}
                    </span>
                  ))
                )}
              </dd>
            </>
          )}
          <dt className="text-lontar-mute">Jatuh tempo</dt>
          <dd className="m-0">
            {candidate.dueDate ? formatDateId(candidate.dueDate) : <span className="text-lontar-mute">belum ditentukan</span>}
            {candidate.dueTime ? ` · ${candidate.dueTime} WIB` : candidate.dueDate ? ' (jam belum ditentukan)' : ''}
          </dd>
          {candidate.location && (
            <>
              <dt className="text-lontar-mute">Lokasi</dt>
              <dd className="m-0">{candidate.location}</dd>
            </>
          )}
          <dt className="text-lontar-mute">Bukti ({candidate.sourceSegmentId})</dt>
          <dd className="m-0 italic text-lontar-sub">“{candidate.evidenceQuote}”</dd>
          {preview && (
            <>
              <dt className="text-lontar-mute">{preview.label}</dt>
              <dd className="m-0 whitespace-pre-line rounded-md border border-lontar-line bg-lontar-head px-3 py-2.5">{preview.text}</dd>
            </>
          )}
        </dl>
      )}

      {(myWarnings.length > 0 || myIssues.length > 0 || (confirm && !settled) || children) && (
        <div className="flex flex-col gap-3 px-5 pb-3.5 text-[13px]">
          {myWarnings.map((w, i) => (
            <div key={i} className="rounded-lg bg-warning-soft px-3 py-2.5 text-warning">
              <strong>Aturan:</strong> {w.message}
              {(w.suggestedDate || w.suggestedTime) && (
                <> Saran: {[w.suggestedDate && formatDateId(w.suggestedDate), w.suggestedTime && `${w.suggestedTime} WIB`].filter(Boolean).join(' · ')}.</>
              )}
            </div>
          ))}
          {myIssues.map((e, i) => (
            <div key={i} className="rounded-lg bg-destructive-soft px-3 py-2.5 text-destructive">
              <strong>Bukti:</strong> {e.message}
            </div>
          ))}
          {confirm && !settled && (
            <label className="flex min-h-[44px] cursor-pointer items-center gap-2.5 rounded-lg border border-lontar-warnLine bg-lontar-warnBg px-3 py-2">
              <input
                type="checkbox"
                checked={confirm.checked}
                onChange={(e) => confirm.onChange(e.target.checked)}
                className="h-4 w-4 shrink-0 accent-[#B45309]"
              />
              <span>{confirmText}</span>
            </label>
          )}
          {children}
        </div>
      )}
    </section>
  );
}
