import { prisma } from '@/lib/db';
import type { ActionCandidate } from '@/lib/agent/types';
import { matchContactsByName } from './match';

/**
 * Resolved recipient information — stored as JSON in the `recipients` String[] field.
 * Each element is a JSON string of this object.
 */
export interface RecipientInfo {
  contactId: string;
  name: string;
  email: string | null;
  phone: string | null;
  timezone: string;
  location: string | null;
  department: string | null;
  isExternal: boolean;
}

/**
 * Resolve a contact name to Contact records from the database.
 * Uses fuzzy matching: first tries exact name match, then first name match.
 * Returns all matching contacts (may be >1 for ambiguous names like "Budi").
 */
export async function findContactsByName(name: string): Promise<RecipientInfo[]> {
  // Contact list is small; match in-process with the same rules the clarifier uses
  // (honorifics stripped, whole-word tokens, first-name preference).
  const all = await prisma.contact.findMany();
  return matchContactsByName(all, name).map(toRecipientInfo);
}

/**
 * Resolve owner of a candidate to a single contact.
 * If exactly one match, return it. If multiple, return null (ambiguous — handled by clarifier).
 */
export async function resolveOwner(ownerName: string): Promise<RecipientInfo | null> {
  const matches = await findContactsByName(ownerName);
  if (matches.length === 1) {
    return matches[0];
  }
  return null; // Ambiguous or not found — clarifier will handle
}

/**
 * Resolve the explicit `recipients` entries (email, phone or name) of a candidate.
 * Only entries that match exactly one contact are kept — an ambiguous or unknown
 * entry is never guessed, so it cannot silently widen the send list.
 */
async function resolveExplicitRecipients(candidate: ActionCandidate): Promise<RecipientInfo[]> {
  if (!candidate.recipients || candidate.recipients.length === 0) return [];
  const all = await prisma.contact.findMany();
  const resolved: RecipientInfo[] = [];
  for (const ref of candidate.recipients) {
    const key = ref.trim().toLowerCase();
    if (!key) continue;
    const digits = key.replace(/\D/g, '');
    let matches = all.filter(
      (c: any) =>
        (c.email && c.email.toLowerCase() === key) ||
        (digits.length >= 8 && c.phone && c.phone.replace(/\D/g, '') === digits)
    );
    if (matches.length === 0) matches = matchContactsByName(all, ref);
    if (matches.length === 1 && !resolved.find((r) => r.contactId === matches[0].id)) {
      resolved.push(toRecipientInfo(matches[0]));
    }
  }
  return resolved;
}

/**
 * Resolve all recipients for a candidate.
 * - For email/whatsapp, explicit `recipients` win; the owner is only the fallback.
 * - Otherwise the owner is the primary recipient.
 * - For calendar, owner + explicit recipients + all meeting participants.
 * - If owner is ambiguous (≥2 matches), return all matches so clarifier can ask.
 */
export async function resolveRecipients(
  candidate: ActionCandidate,
  participants?: string[]
): Promise<RecipientInfo[]> {
  const recipients: RecipientInfo[] = [];
  const explicit = await resolveExplicitRecipients(candidate);

  // A message goes to whoever it is addressed to, not to the person tasked with sending it
  if ((candidate.actionType === 'email' || candidate.actionType === 'whatsapp') && explicit.length > 0) {
    return explicit;
  }

  // Resolve owner
  const ownerMatches = await findContactsByName(candidate.owner);
  if (ownerMatches.length === 1) {
    recipients.push(ownerMatches[0]);
  } else if (ownerMatches.length > 1) {
    // Ambiguous — return all matches so clarifier can ask "Budi yang mana?"
    recipients.push(...ownerMatches);
  }

  // Calendar invitees named on the candidate itself
  if (candidate.actionType === 'calendar') {
    for (const r of explicit) {
      if (!recipients.find((x) => x.contactId === r.contactId)) recipients.push(r);
    }
  }

  // For calendar events, add all participants as recipients
  if (candidate.actionType === 'calendar' && participants && participants.length > 0) {
    for (const pName of participants) {
      const pMatches = await findContactsByName(pName);
      for (const p of pMatches) {
        if (!recipients.find(r => r.contactId === p.contactId)) {
          recipients.push(p);
        }
      }
    }
  }

  // For external contacts flagged on candidate
  if (candidate.isExternal && ownerMatches.length === 0) {
    // Try to find external contact by name
    const externalMatch = await prisma.contact.findFirst({
      where: {
        name: { contains: candidate.owner, mode: 'insensitive' },
        isExternal: true,
      },
    });
    if (externalMatch) {
      recipients.push(toRecipientInfo(externalMatch));
    }
  }

  return recipients;
}

/**
 * Serialize recipients to JSON strings for DB storage in String[] field.
 */
export function serializeRecipients(recipients: RecipientInfo[]): string[] {
  return recipients.map(r => JSON.stringify(r));
}

/**
 * Deserialize recipients from DB String[] field back to RecipientInfo[].
 */
export function deserializeRecipients(recipientsStr: string[]): RecipientInfo[] {
  return recipientsStr.map(s => {
    try {
      return JSON.parse(s) as RecipientInfo;
    } catch {
      // Fallback: treat as plain email/name string
      return {
        contactId: 'unknown',
        name: s,
        email: s,
        phone: null,
        timezone: 'WIB',
        location: null,
        department: null,
        isExternal: false,
      };
    }
  });
}

function toRecipientInfo(c: any): RecipientInfo {
  return {
    contactId: c.id,
    name: c.name,
    email: c.email,
    phone: c.phone,
    timezone: c.timezone,
    location: c.location,
    department: c.department,
    isExternal: c.isExternal,
  };
}
