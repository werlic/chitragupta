import type { Prisma, Role } from '@prisma/client';
import { can } from './rbac';

/**
 * Tasks a user may see: all of them with meeting:view_all or task:assign (Admin, Director, Manager);
 * otherwise those assigned to them plus those from meetings they created (Secretary, Staff).
 * Shared by /api/tasks and /api/tasks/pending so both lists agree.
 */
export function taskScope(user: { userId: string; role: Role }): Prisma.ActionCandidateWhereInput {
  if (can(user.role, 'meeting:view_all') || can(user.role, 'task:assign')) return {};
  return { OR: [{ assigneeId: user.userId }, { meeting: { creatorId: user.userId } }] };
}
