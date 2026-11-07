import { prisma } from '@/lib/db';
import { verifyApproval, generateApprovalToken, generateIdempotencyKey } from '@/lib/utils/crypto';
import { checkIdempotency, storeIdempotencyKey } from './idempotency';

export class ExecutionSecretMissingError extends Error {
  constructor() {
    super('JWT_SECRET belum di-set; approval token tidak bisa dibuat atau diverifikasi.');
    this.name = 'ExecutionSecretMissingError';
  }
}

// No default secret: a guessable fallback would let anyone forge approval tokens
function executionSecret(): string {
  const secret = process.env.JWT_SECRET?.trim();
  if (!secret) throw new ExecutionSecretMissingError();
  return secret;
}

export interface ApprovalRequest {
  meetingId: string;
  planJson: string;
  approvalToken: string;
}

/**
 * Signed record of an approval: HMAC over the hash of the approved plan.
 * The plan hash itself is verified against the DB in /api/agent/approve.
 */
export function createApprovalToken(planHash: string): string {
  return generateApprovalToken(planHash, executionSecret());
}

export function verifyApprovalToken(planHash: string, token: string): boolean {
  return verifyApproval(planHash, token, executionSecret());
}

export async function checkExecutionGate(
  meetingId: string,
  candidateId: string,
  actionType: string
): Promise<{ allowed: boolean; reason?: string; existingExecutionId?: string }> {
  // Check idempotency (the caller logs IDEMPOTENCY_CHECK with this result)
  const idemResult = await checkIdempotency(meetingId, candidateId, actionType);
  if (idemResult.executed) {
    return {
      allowed: false,
      reason: `Sudah dieksekusi (idempotency key exists, executionId: ${idemResult.executionId})`,
      existingExecutionId: idemResult.executionId,
    };
  }

  return { allowed: true };
}

export async function recordExecution(
  meetingId: string,
  dbCandidateId: string,
  candidateId: string,
  actionType: string,
  tool: string,
  mockOutput: Record<string, unknown>,
  userId?: string
): Promise<string> {
  const record = await prisma.executionRecord.create({
    data: {
      candidateId: dbCandidateId,
      userId,
      tool,
      mockOutput: mockOutput as any,
      status: 'SUCCESS',
    },
  });

  await storeIdempotencyKey(meetingId, candidateId, actionType, record.id);

  return record.id;
}

export async function undoExecution(executionId: string): Promise<boolean> {
  const record = await prisma.executionRecord.findUnique({
    where: { id: executionId },
  });
  if (!record) return false;

  await prisma.executionRecord.update({
    where: { id: executionId },
    data: { status: 'UNDONE' },
  });

  // Remove idempotency key
  await prisma.idempotencyKey.deleteMany({
    where: { executionId },
  });

  return true;
}
