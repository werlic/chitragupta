import { prisma } from '@/lib/db';
import { generateIdempotencyKey } from '@/lib/utils/crypto';

// One key per (meeting, candidate, tool) regardless of case: the approve route passes the
// Prisma enum ('EMAIL') while tool mocks store the tool name ('email')
function normalizeActionType(actionType: string): string {
  return actionType.trim().toLowerCase();
}

export async function checkIdempotency(
  meetingId: string,
  candidateId: string,
  actionType: string
): Promise<{ executed: boolean; executionId?: string }> {
  const key = generateIdempotencyKey(meetingId, candidateId, normalizeActionType(actionType));
  const existing = await prisma.idempotencyKey.findUnique({
    where: { key },
  });
  if (existing?.executionId) {
    return { executed: true, executionId: existing.executionId };
  }
  return { executed: false };
}

export async function storeIdempotencyKey(
  meetingId: string,
  candidateId: string,
  actionType: string,
  executionId?: string
): Promise<void> {
  const type = normalizeActionType(actionType);
  const key = generateIdempotencyKey(meetingId, candidateId, type);
  await prisma.idempotencyKey.upsert({
    where: { key },
    create: { key, meetingId, candidateId, actionType: type, executionId },
    update: { executionId },
  });
}
