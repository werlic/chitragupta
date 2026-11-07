import type { ActionCandidate } from '../types';
import { recordExecution } from '../execution/gate';
import { startUndoWindow } from '../execution/undo-window';
import { prisma } from '@/lib/db';
import { emailBody } from './templates';

export async function executeEmailMock(
  meetingId: string,
  candidate: ActionCandidate,
  dbCandidateId: string,
  userId?: string
): Promise<{ executionId: string; undoDeadline: number }> {
  // Meeting title for "Terlampir notulen <judul>"; best effort, the email still goes out without it
  const meetingTitle = await prisma.meeting
    .findUnique({ where: { id: meetingId }, select: { title: true } })
    .then((m) => m?.title ?? null)
    .catch(() => null);
  const mockOutput = {
    tool: 'email',
    from: 'noreply@company.id',
    to: candidate.recipients,
    subject: candidate.title,
    body: emailBody({ owner: candidate.owner, title: candidate.title, dueDate: candidate.dueDate, meetingTitle }),
    sentAt: new Date().toISOString(),
    mock: true,
  };

  const executionId = await recordExecution(meetingId, dbCandidateId, candidate.id, 'email', 'email', mockOutput, userId);
  const undoDeadline = startUndoWindow(executionId, () => {
    console.info(`[EmailMock] Undo window expired for ${executionId}`);
  });

  return { executionId, undoDeadline };
}

export async function executeCalendarMock(
  meetingId: string,
  candidate: ActionCandidate,
  dbCandidateId: string,
  userId?: string
): Promise<{ executionId: string; undoDeadline: number }> {
  const mockOutput = {
    tool: 'calendar',
    eventId: `cal_${Date.now()}`,
    title: candidate.title,
    organizer: candidate.owner,
    date: candidate.dueDate,
    time: candidate.dueTime,
    location: candidate.location || 'Online',
    attendees: candidate.recipients,
    createdAt: new Date().toISOString(),
    mock: true,
  };

  const executionId = await recordExecution(meetingId, dbCandidateId, candidate.id, 'calendar', 'calendar', mockOutput, userId);
  const undoDeadline = startUndoWindow(executionId, () => {
    console.info(`[CalendarMock] Undo window expired for ${executionId}`);
  });

  return { executionId, undoDeadline };
}

export async function executeTaskMock(
  meetingId: string,
  candidate: ActionCandidate,
  dbCandidateId: string,
  userId?: string
): Promise<{ executionId: string; undoDeadline: number }> {
  const mockOutput = {
    tool: 'task',
    taskId: `task_${Date.now()}`,
    title: candidate.title,
    assignee: candidate.owner,
    dueDate: candidate.dueDate,
    dueTime: candidate.dueTime,
    status: 'TODO',
    createdAt: new Date().toISOString(),
    mock: true,
  };

  const executionId = await recordExecution(meetingId, dbCandidateId, candidate.id, 'task', 'task', mockOutput, userId);
  const undoDeadline = startUndoWindow(executionId, () => {
    console.info(`[TaskMock] Undo window expired for ${executionId}`);
  });

  return { executionId, undoDeadline };
}

export async function executeWhatsAppMock(
  meetingId: string,
  candidate: ActionCandidate,
  dbCandidateId: string,
  userId?: string
): Promise<{ executionId: string; undoDeadline: number }> {
  const mockOutput = {
    tool: 'whatsapp',
    from: '+62-811-0000-0000',
    to: candidate.recipients,
    template: 'meeting_reminder',
    message: `*${candidate.title}*\n\nHalo, ini pengingat untuk tugas yang ditugaskan kepada ${candidate.owner}. Jatuh tempo: ${candidate.dueDate || '-'}.\n\n— Chitragupta`,
    sentAt: new Date().toISOString(),
    mock: true,
  };

  const executionId = await recordExecution(meetingId, dbCandidateId, candidate.id, 'whatsapp', 'whatsapp', mockOutput, userId);
  const undoDeadline = startUndoWindow(executionId, () => {
    console.info(`[WhatsAppMock] Undo window expired for ${executionId}`);
  });

  return { executionId, undoDeadline };
}

// Dispatcher
export async function executeTool(
  meetingId: string,
  candidate: ActionCandidate,
  dbCandidateId: string,
  userId?: string
): Promise<{ executionId: string; undoDeadline: number }> {
  switch (candidate.actionType) {
    case 'email':
      return executeEmailMock(meetingId, candidate, dbCandidateId, userId);
    case 'calendar':
      return executeCalendarMock(meetingId, candidate, dbCandidateId, userId);
    case 'task':
      return executeTaskMock(meetingId, candidate, dbCandidateId, userId);
    case 'whatsapp':
      return executeWhatsAppMock(meetingId, candidate, dbCandidateId, userId);
    default:
      throw new Error(`Unknown action type: ${candidate.actionType}`);
  }
}
