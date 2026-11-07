import rules from '../../../data/datapack/rules.json';
import type { ActionCandidate } from './types';
import { matchContactsByName } from '@/lib/contacts/match';

export type Zone = 'WIB' | 'WITA' | 'WIT';

interface ZoneContact {
  name: string;
  timezone: string;
  email?: string | null;
  phone?: string | null;
}

// UTC offsets and cities per zone come from data/datapack/rules.json
const ZONES = rules.timeZones as Record<Zone, { utcOffset: number; cities: string[] }>;

export function isZone(z: string | null | undefined): z is Zone {
  return !!z && z in ZONES;
}

export function zoneOffset(zone: Zone): number {
  return ZONES[zone].utcOffset;
}

/** Explicit zone written in the text ("jam 15:30 WITA"), if any. */
export function explicitZone(text: string): Zone | null {
  const m = text.match(/\b(WIB|WITA|WIT)\b/);
  return m ? (m[1] as Zone) : null;
}

/** Zones of cities named in the text ("Agus di Makassar" → WITA). */
export function zonesFromCities(text: string): Zone[] {
  const lower = text.toLowerCase();
  return (Object.keys(ZONES) as Zone[]).filter((z) =>
    ZONES[z].cities.some((city) => new RegExp(`\\b${city.toLowerCase()}\\b`).test(lower))
  );
}

/** Contacts written by full name in the text ("Nur Hidayah", "Pak Hendra"). */
export function contactsNamedIn<T extends ZoneContact>(contacts: T[], text: string): T[] {
  const lower = ` ${text.toLowerCase().replace(/[^\p{L}\p{N}\s]/gu, ' ').replace(/\s+/g, ' ')} `;
  return contacts.filter((c) => {
    const full = c.name.toLowerCase().replace(/^(pak|bu|bapak|ibu)\s+/, '').trim();
    return full.includes(' ') ? lower.includes(` ${full} `) : lower.includes(` ${c.name.toLowerCase()} `);
  });
}

/**
 * Every zone touched by one action: owner, meeting participants, recipients
 * (email/phone/name), contacts and cities named in its title/quote, and the plan creator.
 */
export function zonesForCandidate<T extends ZoneContact>(
  c: Pick<ActionCandidate, 'owner' | 'title' | 'evidenceQuote' | 'recipients'>,
  contacts: T[],
  participants: string[] = [],
  creatorTimezone?: string
): Set<Zone> {
  const words = `${c.title} ${c.evidenceQuote}`;
  const recipients = (c.recipients || []).map((r) => r.toLowerCase());
  const involved = [
    ...matchContactsByName(contacts, c.owner || ''),
    ...participants.flatMap((p) => matchContactsByName(contacts, p)),
    ...contacts.filter(
      (ct) =>
        recipients.includes((ct.email || '').toLowerCase()) ||
        recipients.includes((ct.phone || '').toLowerCase()) ||
        recipients.some((r) => matchContactsByName([ct], r).length > 0)
    ),
    ...contactsNamedIn(contacts, words),
  ];
  const zones = new Set<Zone>();
  for (const ct of involved) if (isZone(ct.timezone)) zones.add(ct.timezone);
  for (const z of zonesFromCities(words)) zones.add(z);
  if (zones.size > 0 && isZone(creatorTimezone)) zones.add(creatorTimezone);
  return zones;
}

/** Shift "HH:MM" from one zone to another (same day wrap ignored beyond 24h). */
export function convertTime(time: string, from: Zone, to: Zone): string {
  const [h, m] = time.split(':').map(Number);
  const total = (((h * 60 + m + (zoneOffset(to) - zoneOffset(from)) * 60) % 1440) + 1440) % 1440;
  return `${String(Math.floor(total / 60)).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`;
}
