import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/auth';
import { can } from '@/lib/auth/rbac';
import { deleteSession, findOwnSession, renameSession, sessionView, validTitle } from '@/lib/chat/ai-sessions';

type Params = { params: Promise<{ id: string }> };

// Someone else's session and a missing one get the same answer
const notFound = () => NextResponse.json({ error: 'Sesi tidak ditemukan' }, { status: 404 });

// PATCH { title }: rename (1–80 characters)
export async function PATCH(request: NextRequest, { params }: Params) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (!can(user.role, 'chat:ai')) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  const { id } = await params;
  const session = await findOwnSession(user.userId, id);
  if (!session) return notFound();

  const body = await request.json().catch(() => ({}));
  const title = validTitle((body as { title?: unknown })?.title);
  if (!title) return NextResponse.json({ error: 'Judul harus 1–80 karakter.' }, { status: 400 });

  const updated = await renameSession(session.id, title);
  return NextResponse.json({ session: await sessionView(updated) });
}

// DELETE: removes the session and its messages; meetings and plans made from it stay
export async function DELETE(_request: NextRequest, { params }: Params) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (!can(user.role, 'chat:ai')) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  const { id } = await params;
  const session = await findOwnSession(user.userId, id);
  if (!session) return notFound();

  await deleteSession(session.id);
  return NextResponse.json({ ok: true });
}
