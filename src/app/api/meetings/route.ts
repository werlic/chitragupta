import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/auth';
import { can } from '@/lib/auth/rbac';
import { prisma } from '@/lib/db';

export async function GET() {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  // Role-based filtering
  let where: any = {};
  if (can(user.role, 'meeting:view_all')) {
    // Director, Manager, Admin — see all
    where = {};
  } else {
    // Secretary, Staff — see own meetings
    where = { creatorId: user.userId };
  }

  const meetings = await prisma.meeting.findMany({
    where,
    orderBy: { createdAt: 'desc' },
    include: {
      creator: { select: { name: true, role: true } },
      _count: { select: { candidates: true } },
    },
  });

  return NextResponse.json({ meetings });
}

export async function POST(request: NextRequest) {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  if (!can(user.role, 'meeting:create')) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const body = await request.json();
  const { title } = body;

  const meeting = await prisma.meeting.create({
    data: {
      title: title || 'Untitled Meeting',
      rawText: '',
      creatorId: user.userId,
    },
  });

  return NextResponse.json({ meeting });
}
