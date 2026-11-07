import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/auth';
import { prisma } from '@/lib/db';

// AI sessions are private and live under /api/chat/ai/**; this route only knows group/DM channels
const CHANNEL_TYPES = ['GROUP', 'DM'] as const;

export async function GET() {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  // Get channels where user is a member
  const channels = await prisma.chatChannel.findMany({
    where: {
      type: { not: 'AI' },
      members: { some: { userId: user.userId } },
    },
    include: {
      _count: { select: { messages: true, members: true } },
    },
    orderBy: { createdAt: 'asc' },
  });

  return NextResponse.json({ channels });
}

export async function POST(request: NextRequest) {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const body = await request.json().catch(() => null);
  const { name, type, description, memberIds } = (body || {}) as {
    name?: unknown;
    type?: unknown;
    description?: unknown;
    memberIds?: unknown;
  };

  const channelType = (type ?? 'GROUP') as (typeof CHANNEL_TYPES)[number];
  if (!CHANNEL_TYPES.includes(channelType)) {
    return NextResponse.json({ error: 'Jenis channel tidak valid. Sesi AI dibuat lewat /api/chat/ai/sessions.' }, { status: 400 });
  }
  if (typeof name !== 'string' || !name.trim()) {
    return NextResponse.json({ error: 'Nama channel wajib diisi.' }, { status: 400 });
  }
  const others = Array.isArray(memberIds) ? memberIds.filter((id): id is string => typeof id === 'string') : [];
  const members = [...new Set([user.userId, ...others])];

  const channel = await prisma.chatChannel.create({
    data: {
      name: name.trim(),
      type: channelType,
      description: typeof description === 'string' ? description : undefined,
      members: { create: members.map((userId) => ({ userId })) },
    },
  });

  return NextResponse.json({ channel });
}
