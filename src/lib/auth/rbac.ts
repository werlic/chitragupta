import { Role } from '@prisma/client';

export type Permission =
  | '*'
  | 'meeting:create'
  | 'meeting:view_all'
  | 'meeting:view_own'
  | 'task:assign'
  | 'task:view_own'
  | 'execution:approve'
  | 'execution:undo'
  | 'user:manage'
  | 'data:manage'
  | 'chat:ai'
  | 'chat:group'
  | 'audit:view';

const PERMISSIONS: Record<Role, Permission[]> = {
  // Every role has task:view_own (the Tugas menu); /api/tasks narrows what each one sees
  ADMIN: ['*'],
  // Directors assign work from meetings too; a plan still needs approval before anything runs
  DIRECTOR: ['meeting:create', 'meeting:view_all', 'task:assign', 'task:view_own', 'execution:approve', 'execution:undo', 'chat:group', 'chat:ai', 'audit:view'],
  MANAGER: ['meeting:create', 'meeting:view_all', 'task:assign', 'task:view_own', 'chat:group', 'chat:ai', 'execution:undo'],
  SECRETARY: ['meeting:create', 'meeting:view_own', 'task:view_own', 'chat:group', 'chat:ai'],
  STAFF: ['meeting:view_own', 'task:view_own', 'chat:group', 'chat:ai'],
};

export function can(role: Role, action: Permission): boolean {
  const perms = PERMISSIONS[role] || [];
  return perms.includes('*') || perms.includes(action);
}

export function getPermissions(role: Role): Permission[] {
  return PERMISSIONS[role] || [];
}

export function hasAnyPermission(role: Role): boolean {
  return (PERMISSIONS[role] || []).length > 0;
}
