import { NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/auth';
import { can } from '@/lib/auth/rbac';
import { prisma } from '@/lib/db';

export async function GET() {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  if (!can(user.role, 'audit:view') && !can(user.role, 'data:manage')) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const logs = await prisma.auditLog.findMany({
    orderBy: { createdAt: 'desc' },
    take: 100,
    include: {
      meeting: { select: { title: true } },
      user: { select: { name: true } },
    },
  });

  return NextResponse.json({ logs });
}
