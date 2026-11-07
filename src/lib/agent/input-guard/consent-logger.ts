import { logAudit } from '../audit-logger';

export interface ConsentMetadata {
  participantName: string;
  consentGiven: boolean;
  consentTimestamp: string;
  retentionUntil: string; // now + 5 years (UU PDP)
}

export async function logConsent(
  meetingId: string,
  consent: ConsentMetadata,
  userId?: string
): Promise<void> {
  const retentionDate = getRetentionDate();

  // Through logAudit so the meetingId COLUMN is set (getAuditLogs(meetingId) finds it) and JSONL is written
  await logAudit({
    type: 'CONSENT_LOGGED',
    meetingId,
    userId,
    payload: {
      meetingId,
      participant: consent.participantName,
      consentGiven: consent.consentGiven,
      consentTimestamp: consent.consentTimestamp,
      retentionUntil: retentionDate.toISOString(),
      regulation: 'UU PDP No. 27/2022 — Pasal 46 (retention 5 tahun)',
    },
  });
}

export function getRetentionDate(): Date {
  const date = new Date();
  date.setFullYear(date.getFullYear() + 5);
  return date;
}
