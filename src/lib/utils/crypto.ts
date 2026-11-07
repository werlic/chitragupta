import { createHash, createHmac } from 'crypto';

export function sha256(data: string): string {
  return createHash('sha256').update(data, 'utf8').digest('hex');
}

export function hmacSHA256(data: string, secret: string): string {
  return createHmac('sha256', secret).update(data, 'utf8').digest('hex');
}

export function verifyApproval(planJson: string, approvalToken: string, secret: string): boolean {
  const expected = hmacSHA256(sha256(planJson), secret);
  return expected === approvalToken;
}

export function generateApprovalToken(planJson: string, secret: string): string {
  return hmacSHA256(sha256(planJson), secret);
}

export function generateIdempotencyKey(meetingId: string, candidateId: string, actionType: string): string {
  return `${meetingId}::${candidateId}::${actionType}`;
}
