import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/auth';
import { can } from '@/lib/auth/rbac';
import { llmMode } from '@/lib/chat/llm-mode';
import { findOwnSession, sessionMessages, sessionView } from '@/lib/chat/ai-sessions';

// GET: session history; plan cards carry the plan's current status from the database
export async function GET(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (!can(user.role, 'chat:ai')) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  const { id } = await params;
  const session = await findOwnSession(user.userId, id);
  if (!session) return NextResponse.json({ error: 'Sesi tidak ditemukan' }, { status: 404 });

  return NextResponse.json({
    session: await sessionView(session),
    messages: await sessionMessages(user.userId, session.id),
    ...llmMode(),
  });
}
