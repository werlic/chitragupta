import { AuditLogCard } from '@/components/audit/audit-log-card';
import { ScreenHeader } from '@/components/shell/lontar';
import { RequirePermission } from '@/components/shell/require-permission';

export default function Page() {
  return (
    <>
      <ScreenHeader crumbs={[{ label: 'Data master' }]} right="Data sistem dan audit trail" />
      <main className="mx-auto flex max-w-[1200px] flex-col gap-4 px-8 py-6 max-sm:px-4">
        <h1 className="m-0 text-[30px] font-bold tracking-[-0.02em]">Data master &amp; audit log</h1>
        {/* Same rule as /api/admin/audit; no request when the role lacks it */}
        <RequirePermission perms={['data:manage']}>
          <AuditLogCard />
        </RequirePermission>
      </main>
    </>
  );
}
