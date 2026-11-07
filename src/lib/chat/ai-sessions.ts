import { prisma } from '@/lib/db';
import { buildPlanCard, type PlanCard } from './plan-card';

/**
 * AI chat sessions. A session is a ChatChannel of type AI whose ONLY member is
 * its owner, so one user's history (and LLM context) never reaches another user.
 * Lookups for someone else's session return null and routes answer 404.
 */
export const DEFAULT_SESSION_TITLE = 'Chat baru';
export const MAX_TITLE_LENGTH = 80;
const AUTO_TITLE_LENGTH = 40;

// Channels made before sessions existed were named "AI Assistant - <name>"
const LEGACY_NAME = /^AI Assistant - /;
// tool-registry fallback title: not worth showing as a session name
const GENERIC_PLAN_TITLE = /^Rencana dari AI Assistant/i;

export interface SessionView {
  id: string;
  title: string;
  updatedAt: Date;
  pendingApproval: boolean;
  lastMeetingId: string | null;
}

export interface MessageView {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  createdAt: Date;
  plan: PlanCard | null;
}

/** What an assistant message stores in ChatMessage.meta */
export interface AssistantMeta {
  plans: PlanCard[];
}

export const ownSessionWhere = (userId: string) => ({
  type: 'AI' as const,
  members: { some: { userId }, every: { userId } },
});

export function isDefaultTitle(name: string): boolean {
  return name === DEFAULT_SESSION_TITLE || LEGACY_NAME.test(name);
}

export function sessionTitle(name: string): string {
  return LEGACY_NAME.test(name) ? DEFAULT_SESSION_TITLE : name;
}

/** Trimmed title, or null when empty or longer than MAX_TITLE_LENGTH. */
export function validTitle(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const t = raw.replace(/\s+/g, ' ').trim();
  return t.length >= 1 && t.length <= MAX_TITLE_LENGTH ? t : null;
}

/**
 * Title from the first message (already through the input guard, so no PII):
 * first line, quarantine markers removed, ~40 chars cut at a word boundary.
 */
export function titleFromMessage(cleanedText: string): string {
  const line =
    cleanedText
      .split('\n')
      .map((l) => l.replace(/\[QUARANTINED\]/g, '').replace(/\s+/g, ' ').trim())
      .find(Boolean) || '';
  if (!line) return DEFAULT_SESSION_TITLE;
  if (line.length <= AUTO_TITLE_LENGTH) return line;
  const cut = line.slice(0, AUTO_TITLE_LENGTH);
  const space = cut.lastIndexOf(' ');
  return `${(space > 20 ? cut.slice(0, space) : cut).trim()}…`;
}

/** Title from a saved plan, unless it is the generic fallback. */
export function titleFromPlan(planTitle: string): string | null {
  const t = validTitle(planTitle.slice(0, MAX_TITLE_LENGTH));
  return t && !GENERIC_PLAN_TITLE.test(t) ? t : null;
}

export async function findOwnSession(userId: string, id: string) {
  if (!id || typeof id !== 'string') return null;
  return prisma.chatChannel.findFirst({ where: { id, ...ownSessionWhere(userId) } });
}

export async function createSession(userId: string, title = DEFAULT_SESSION_TITLE) {
  return prisma.chatChannel.create({
    data: {
      name: title,
      type: 'AI',
      description: 'Personal AI assistant chat',
      members: { create: [{ userId }] },
    },
  });
}

export async function renameSession(id: string, title: string) {
  return prisma.chatChannel.update({ where: { id }, data: { name: title, updatedAt: new Date() } });
}

export async function touchSession(id: string) {
  return prisma.chatChannel.update({ where: { id }, data: { updatedAt: new Date() } });
}

/** Deletes the session and its messages. Meetings made from it stay (they are the audit trail). */
export async function deleteSession(id: string) {
  await prisma.$transaction([
    prisma.chatMessage.deleteMany({ where: { channelId: id } }),
    prisma.channelMember.deleteMany({ where: { channelId: id } }),
    prisma.chatChannel.delete({ where: { id } }),
  ]);
}

/** Session list fields for the given channels (pendingApproval = a plan of this session is READY). */
export async function toSessionViews(
  channels: { id: string; name: string; updatedAt: Date }[]
): Promise<SessionView[]> {
  if (channels.length === 0) return [];
  const linked = await prisma.chatMessage.findMany({
    where: { channelId: { in: channels.map((c) => c.id) }, meetingId: { not: null } },
    orderBy: { createdAt: 'desc' },
    select: { channelId: true, meetingId: true },
  });
  const meetingIds = [...new Set(linked.map((m) => m.meetingId as string))];
  const meetings = meetingIds.length
    ? await prisma.meeting.findMany({ where: { id: { in: meetingIds } }, select: { id: true, status: true } })
    : [];
  const status = new Map(meetings.map((m) => [m.id, m.status]));

  return channels.map((c) => {
    const mine = linked.filter((m) => m.channelId === c.id);
    return {
      id: c.id,
      title: sessionTitle(c.name),
      updatedAt: c.updatedAt,
      pendingApproval: mine.some((m) => status.get(m.meetingId as string) === 'READY'),
      // A deleted meeting is not offered as a link
      lastMeetingId: (mine.find((m) => status.has(m.meetingId as string))?.meetingId as string) ?? null,
    };
  });
}

export async function listSessions(userId: string): Promise<SessionView[]> {
  const channels = await prisma.chatChannel.findMany({
    where: ownSessionWhere(userId),
    orderBy: { updatedAt: 'desc' },
  });
  return toSessionViews(channels);
}

export async function sessionView(channel: { id: string; name: string; updatedAt: Date }): Promise<SessionView> {
  return (await toSessionViews([channel]))[0];
}

/**
 * Messages of one session, oldest first. Plan cards are rebuilt from the database so a
 * plan that was clarified, approved, executed or rejected since shows its current state;
 * the stored snapshot is used only when the meeting is gone.
 */
export async function sessionMessages(userId: string, channelId: string, limit = 200): Promise<MessageView[]> {
  const rows = await prisma.chatMessage.findMany({
    where: { channelId },
    orderBy: { createdAt: 'desc' },
    take: limit,
  });
  rows.reverse();

  const out: MessageView[] = [];
  for (const m of rows) {
    const plans = (m.meta as unknown as AssistantMeta | null)?.plans || [];
    const snapshot = plans.length > 0 ? plans[plans.length - 1] : null;
    let plan: PlanCard | null = null;
    if (m.isAI && snapshot) {
      plan =
        (await buildPlanCard(snapshot.meetingId, { ownerId: userId, quarantined: snapshot.quarantined })) ?? snapshot;
    }
    out.push({ id: m.id, role: m.isAI ? 'assistant' : 'user', content: m.content, createdAt: m.createdAt, plan });
  }
  return out;
}
