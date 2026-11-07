/**
 * Who may read, write or join a chat channel. Shared by /api/chat/channels/** and
 * the Socket.io server (server.ts runs under plain `node`, so this file has no
 * `@/` imports and only erasable TypeScript).
 *
 * Rule: only members of a GROUP/DM channel. AI channels are private sessions and
 * are reachable only through /api/chat/ai/** (sole-member check there).
 */

export interface ChannelDb {
  chatChannel: { findFirst(args: any): Promise<unknown> };
}

export interface SocketUser {
  userId: string;
  name: string;
  role: string;
}

/** The channel when `userId` is a member and it is not an AI session, else null. */
export async function findMemberChannel(db: ChannelDb, userId: string, channelId: unknown): Promise<{ id: string; type: string } | null> {
  if (!userId || typeof channelId !== 'string' || !channelId) return null;
  const channel = (await db.chatChannel.findFirst({
    where: { id: channelId, type: { not: 'AI' }, members: { some: { userId } } },
  })) as { id: string; type: string } | null;
  return channel ?? null;
}

/** Value of one cookie from a raw Cookie header. */
export function readCookie(header: string | undefined, name: string): string | null {
  if (!header) return null;
  for (const part of header.split(';')) {
    const i = part.indexOf('=');
    if (i < 0) continue;
    if (part.slice(0, i).trim() === name) {
      try {
        return decodeURIComponent(part.slice(i + 1).trim());
      } catch {
        return null;
      }
    }
  }
  return null;
}

/** Identity from the session cookie; `verify` returns the JWT payload or throws/null. */
export function socketUserFromCookie(
  cookieHeader: string | undefined,
  cookieName: string,
  verify: (token: string) => unknown
): SocketUser | null {
  const token = readCookie(cookieHeader, cookieName);
  if (!token) return null;
  let payload: any;
  try {
    payload = verify(token);
  } catch {
    return null;
  }
  if (!payload || typeof payload.userId !== 'string') return null;
  return { userId: payload.userId, name: String(payload.name ?? ''), role: String(payload.role ?? '') };
}
