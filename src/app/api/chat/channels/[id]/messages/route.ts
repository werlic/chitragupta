import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/auth';
import { prisma } from '@/lib/db';
import { findMemberChannel } from '@/lib/chat/channel-access';

// Non-members, AI sessions (only via /api/chat/ai/**) and missing channels get the same answer
const notFound = () => NextResponse.json({ error: 'Channel tidak ditemukan' }, { status: 404 });

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { id } = await params;
  const channel = await findMemberChannel(prisma, user.userId, id);
  if (!channel) return notFound();

  const messages = await prisma.chatMessage.findMany({
    where: { channelId: channel.id },
    orderBy: { createdAt: 'asc' },
    take: 100,
  });

  return NextResponse.json({ messages });
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { id } = await params;
  const channel = await findMemberChannel(prisma, user.userId, id);
  if (!channel) return notFound();

  const body = await request.json().catch(() => null);
  const content = (body as { content?: unknown } | null)?.content;
  if (typeof content !== 'string' || !content.trim()) {
    return NextResponse.json({ error: 'Pesan tidak boleh kosong.' }, { status: 400 });
  }

  const message = await prisma.chatMessage.create({
    data: {
      channelId: channel.id,
      userId: user.userId,
      senderName: user.name,
      senderRole: user.role,
      content,
    },
  });

  return NextResponse.json({ message });
}
