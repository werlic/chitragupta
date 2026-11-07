// Shared display helpers for the Lontar screens (client-safe, no server imports)

const DAYS = ['Min', 'Sen', 'Sel', 'Rab', 'Kam', 'Jum', 'Sab'];
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'Mei', 'Jun', 'Jul', 'Agu', 'Sep', 'Okt', 'Nov', 'Des'];

/** "2026-11-05" -> "Kam, 5 Nov 2026" (calendar date, no timezone shift) */
export function formatDateId(iso?: string | null): string {
  if (!iso) return '';
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso);
  if (!m) return iso;
  const y = Number(m[1]);
  const mo = Number(m[2]);
  const d = Number(m[3]);
  const day = new Date(Date.UTC(y, mo - 1, d)).getUTCDay();
  return `${DAYS[day]}, ${d} ${MONTHS[mo - 1] ?? m[2]} ${y}`;
}

/** Due date + optional time as shown in lists: "Jum, 6 Nov 2026 · 13:30 WIB" */
export function formatDue(dueDate?: string | null, dueTime?: string | null): string {
  if (!dueDate && !dueTime) return '';
  const date = formatDateId(dueDate);
  if (!dueTime) return date;
  return date ? `${date} · ${dueTime} WIB` : `${dueTime} WIB`;
}

/** "3 menit lalu", "2 hari lalu" */
export function timeAgo(value?: string | Date | null): string {
  if (!value) return '';
  const t = new Date(value).getTime();
  if (Number.isNaN(t)) return '';
  const diff = Math.max(0, Date.now() - t);
  const min = Math.floor(diff / 60000);
  if (min < 1) return 'baru saja';
  if (min < 60) return `${min} menit lalu`;
  const h = Math.floor(min / 60);
  if (h < 24) return `${h} jam lalu`;
  const d = Math.floor(h / 24);
  return d === 1 ? 'kemarin' : `${d} hari lalu`;
}

export interface RecipientView {
  name: string;
  detail: string;
  external: boolean;
  timezone?: string;
  location?: string;
}

/** Recipients are stored as JSON strings ({ name, email, phone, timezone, ... }) or plain names */
export function parseRecipient(r: string): RecipientView {
  if (typeof r === 'string' && r.startsWith('{')) {
    try {
      const info = JSON.parse(r);
      return {
        name: info.name || info.email || r,
        detail: [info.email, info.phone, [info.timezone, info.location].filter(Boolean).join(' ')]
          .filter(Boolean)
          .join(' · '),
        external: info.isExternal === true,
        timezone: info.timezone || undefined,
        location: info.location || undefined,
      };
    } catch {
      // Not JSON, use as-is
    }
  }
  return { name: String(r), detail: '', external: false };
}

/** "1 penerima", "6 · 3 zona", "1 · eksternal" */
export function recipientSummary(recipients: string[] | undefined, isExternal?: boolean): string {
  const list = (recipients || []).map(parseRecipient);
  if (list.length === 0) return '—';
  const zones = new Set(list.map((r) => r.timezone).filter(Boolean));
  if (isExternal || list.some((r) => r.external)) return `${list.length} · eksternal`;
  if (zones.size > 1) return `${list.length} · ${zones.size} zona`;
  return `${list.length} penerima`;
}

// Type pills follow the Lontar design system (docs/design/r1-canvas/DesignSystem.dc.html)
export const ACTION_TYPE: Record<string, { label: string; className: string }> = {
  email: { label: 'EMAIL', className: 'bg-accent text-primary' },
  calendar: { label: 'KALENDER', className: 'bg-success-soft text-success' },
  task: { label: 'TASK', className: 'bg-secondary text-secondary-foreground' },
  whatsapp: { label: 'WHATSAPP', className: 'bg-teal-100 text-teal-700 dark:bg-teal-950/40 dark:text-teal-300' },
};

export function actionTypeOf(t?: string | null) {
  return ACTION_TYPE[(t || 'task').toLowerCase()] ?? ACTION_TYPE.task;
}

export const PILL = 'whitespace-nowrap rounded-md px-2 py-[3px] text-[11px] font-bold tracking-[0.04em]';
