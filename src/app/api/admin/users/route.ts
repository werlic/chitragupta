import { NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/auth';
import { can } from '@/lib/auth/rbac';
import { prisma } from '@/lib/db';

export async function GET() {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  if (!can(user.role, 'user:manage')) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const users = await prisma.user.findMany({
    select: {
      id: true,
      email: true,
      name: true,
      role: true,
      timezone: true,
      location: true,
      department: true,
      createdAt: true,
    },
    orderBy: { createdAt: 'asc' },
  });

  return NextResponse.json({ users });
}
