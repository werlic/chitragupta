'use client';

import { useEffect, useRef, useState } from 'react';
import { NoAccess, RequirePermission } from '@/components/shell/require-permission';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Avatar } from '@/components/ui/avatar';
import { RoleBadge } from '@/components/shared/role-badge';
import { formatDate } from '@/lib/utils';
import { Users } from 'lucide-react';
import { ScreenHeader } from '@/components/shell/lontar';

export default function AdminUsersPage() {
  return (
    <>
      <ScreenHeader crumbs={[{ label: 'Kelola user' }]} right="Daftar semua user dan role mereka" />
      <main className="mx-auto flex max-w-[1200px] flex-col gap-4 px-8 py-6 max-sm:px-4">
        <h1 className="m-0 text-[30px] font-bold tracking-[-0.02em]">Kelola user</h1>
        <RequirePermission perms={['user:manage']}>
          <UsersList />
        </RequirePermission>
      </main>
    </>
  );
}

function UsersList() {
  const [users, setUsers] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [denied, setDenied] = useState(false);
  const started = useRef(false);

  useEffect(() => {
    if (started.current) return;
    started.current = true;
    fetch('/api/admin/users')
      .then(async (r) => {
        if (r.status === 401 || r.status === 403) {
          setDenied(true);
          return;
        }
        const data = await r.json().catch(() => ({}));
        setUsers(data.users || []);
      })
      .finally(() => setLoading(false));
  }, []);

  if (denied) return <NoAccess />;

  return (
      <Card>
        <CardHeader>
          <div className="flex items-center gap-2">
            <Users className="h-5 w-5 text-indigo-500" />
            <CardTitle className="text-base">{users.length} User</CardTitle>
          </div>
        </CardHeader>
        <CardContent>
          {loading ? (
            <p className="text-center py-8 text-muted-foreground">Memuat...</p>
          ) : (
            <div className="space-y-2">
              {users.map((u) => (
                <div key={u.id} className="flex items-center gap-3 p-3 rounded-md border hover:bg-accent transition-colors">
                  <Avatar name={u.name} size="md" />
                  <div className="flex-1">
                    <p className="font-semibold text-sm">{u.name}</p>
                    <p className="text-xs text-muted-foreground">{u.email}</p>
                  </div>
                  <div className="flex items-center gap-2">
                    <RoleBadge role={u.role} />
                    <Badge variant="outline" className="text-xs">{u.timezone}</Badge>
                    <span className="text-xs text-muted-foreground hidden sm:inline">{u.department}</span>
                  </div>
                  <span className="text-xs text-muted-foreground hidden md:inline">{formatDate(u.createdAt)}</span>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
  );
}
