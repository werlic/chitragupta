import { cookies } from 'next/headers';
import { verifyToken, COOKIE_NAME, type JWTPayload } from './jwt';
import { prisma } from '@/lib/db';

export async function getCurrentUser(): Promise<JWTPayload | null> {
  const cookieStore = await cookies();
  const token = cookieStore.get(COOKIE_NAME)?.value;
  if (!token) return null;
  return verifyToken(token);
}

export async function getCurrentUserWithProfile() {
  const payload = await getCurrentUser();
  if (!payload) return null;
  const user = await prisma.user.findUnique({
    where: { id: payload.userId },
    select: {
      id: true,
      email: true,
      name: true,
      role: true,
      avatar: true,
      timezone: true,
      location: true,
      department: true,
      phone: true,
    },
  });
  return user;
}

export async function requireAuth(): Promise<JWTPayload> {
  const user = await getCurrentUser();
  if (!user) {
    throw new Error('UNAUTHORIZED');
  }
  return user;
}

export async function requirePermission(action: Parameters<typeof import('./rbac').can>[1]) {
  const user = await requireAuth();
  const { can } = await import('./rbac');
  if (!can(user.role, action)) {
    throw new Error('FORBIDDEN');
  }
  return user;
}
