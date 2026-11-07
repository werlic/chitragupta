import { Badge } from '@/components/ui/badge';
import { Role } from '@prisma/client';

const roleConfig: Record<Role, { label: string; variant: 'destructive' | 'secondary' | 'default' | 'success' | 'info' }> = {
  ADMIN: { label: 'Admin', variant: 'destructive' },
  DIRECTOR: { label: 'Director', variant: 'secondary' },
  MANAGER: { label: 'Manager', variant: 'info' },
  SECRETARY: { label: 'Secretary', variant: 'success' },
  STAFF: { label: 'Staff', variant: 'default' },
};

export function RoleBadge({ role }: { role: Role }) {
  const config = roleConfig[role] || { label: role, variant: 'default' as const };
  return <Badge variant={config.variant}>{config.label}</Badge>;
}
