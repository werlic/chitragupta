import { sha256 } from '@/lib/utils/crypto';

/**
 * The candidate fields a person sees on the confirmation screen.
 * If any of these changes after display, the approval no longer matches.
 */
export interface HashableCandidate {
  candidateId: string;
  actionType: string;
  title: string;
  owner: string;
  ownerId: string | null;
  dueDate: string | null;
  dueTime: string | null;
  location: string | null;
  recipients: string[];
  isExternal: boolean;
  recipientCount: number;
}

/**
 * Hash of exactly what was shown for one candidate. Sent to the client with the
 * candidate and echoed back on approve, so the server can prove the approved
 * details are the ones it is about to execute.
 */
export function hashCandidate(c: HashableCandidate): string {
  return sha256(
    JSON.stringify([
      c.candidateId,
      c.actionType,
      c.title,
      c.owner,
      c.ownerId,
      c.dueDate,
      c.dueTime,
      c.location,
      c.recipients,
      c.isExternal,
      c.recipientCount,
    ])
  );
}

/**
 * Hash of a whole approved plan (order-independent).
 */
export function hashPlan(candidateHashes: string[]): string {
  return sha256([...candidateHashes].sort().join('|'));
}

/**
 * High-impact actions need a second, explicit confirmation:
 * external recipients or more than one recipient.
 */
export function isHighImpact(c: Pick<HashableCandidate, 'isExternal' | 'recipientCount' | 'recipients'>): boolean {
  if (c.isExternal || c.recipientCount > 1) return true;
  return c.recipients.some((r) => {
    try {
      return JSON.parse(r).isExternal === true;
    } catch {
      return false;
    }
  });
}
