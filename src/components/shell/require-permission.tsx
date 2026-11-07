'use client';

// Client-side RBAC gate for secondary screens: no fetch (and no empty list) when the role lacks access.
// The API still enforces the same rule; this only avoids rendering a misleading empty page.
import Link from 'next/link';
import type { Role } from '@prisma/client';
import { can, type Permission } from '@/lib/auth/rbac';
import { useAuthStore } from '@/stores/auth-store';

export function NoAccess() {
  return (
    <div role="alert" className="mx-auto mt-6 flex max-w-[480px] flex-col gap-1.5 rounded-[14px] border border-lontar-dangerLine bg-white p-4">
      <strong className="text-sm text-destructive">Izin tidak cukup</strong>
      <span className="text-[13px] text-lontar-sub">Anda tidak punya izin untuk membuka halaman ini.</span>
      <Link
        href="/dashboard"
        className="mt-1 inline-flex min-h-[40px] items-center self-start rounded-lg border border-lontar-border bg-white px-3.5 text-[13px] text-lontar-text no-underline hover:bg-lontar-head"
      >
        Kembali ke Chat
      </Link>
    </div>
  );
}

/** Renders children only when the role has at least one of `perms` */
export function RequirePermission({ perms, children }: { perms: Permission[]; children: React.ReactNode }) {
  const { user } = useAuthStore();
  if (!user) return null;
  if (!perms.some((p) => can(user.role as Role, p))) return <NoAccess />;
  return <>{children}</>;
}
