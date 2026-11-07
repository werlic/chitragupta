import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/auth';
import { can } from '@/lib/auth/rbac';
import { llmMode } from '@/lib/chat/llm-mode';
import { DEFAULT_SESSION_TITLE, createSession, listSessions, sessionView, validTitle } from '@/lib/chat/ai-sessions';

// GET: the caller's AI chat sessions, newest activity first
export async function GET() {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (!can(user.role, 'chat:ai')) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  return NextResponse.json({ sessions: await listSessions(user.userId), ...llmMode() });
}

// POST { title? }: new empty session owned by the caller
export async function POST(request: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (!can(user.role, 'chat:ai')) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  const body = await request.json().catch(() => ({}));
  const raw = (body as { title?: unknown })?.title;
  let title = DEFAULT_SESSION_TITLE;
  if (raw !== undefined && raw !== null && raw !== '') {
    const t = validTitle(raw);
    if (!t) return NextResponse.json({ error: 'Judul harus 1–80 karakter.' }, { status: 400 });
    title = t;
  }

  const channel = await createSession(user.userId, title);
  return NextResponse.json({ session: await sessionView(channel) }, { status: 201 });
}
