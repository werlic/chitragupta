import { NextResponse } from 'next/server';
import { getCurrentUserWithProfile } from '@/lib/auth';
import { getPermissions } from '@/lib/auth/rbac';

export async function GET() {
  const user = await getCurrentUserWithProfile();
  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  return NextResponse.json({
    user: {
      ...user,
      permissions: getPermissions(user.role),
    },
  });
}
