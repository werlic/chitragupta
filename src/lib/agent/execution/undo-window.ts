export const UNDO_WINDOW_MS = 60_000; // 60 seconds

// Track undo deadlines: executionId → deadline timestamp.
// Kept on globalThis (like the Prisma client): Next dev compiles each route into its own
// module instance, so a module-level Map in /api/agent/approve is not the one /api/agent/undo sees.
type UndoEntry = { deadline: number; timeout: NodeJS.Timeout };
const globalForUndo = globalThis as unknown as { __undoTimers?: Map<string, UndoEntry> };
const undoTimers: Map<string, UndoEntry> = (globalForUndo.__undoTimers ??= new Map());

/** Deadline from the stored execution time, for when the in-memory entry is gone (restart, other instance). */
export function deadlineFromExecutedAt(executedAt: Date | string): number {
  return new Date(executedAt).getTime() + UNDO_WINDOW_MS;
}

export function startUndoWindow(
  executionId: string,
  onExpire: () => void
): number {
  const deadline = Date.now() + UNDO_WINDOW_MS;
  const timeout = setTimeout(() => {
    undoTimers.delete(executionId);
    onExpire();
  }, UNDO_WINDOW_MS);

  undoTimers.set(executionId, { deadline, timeout });
  return deadline;
}

export function cancelUndoWindow(executionId: string): boolean {
  const entry = undoTimers.get(executionId);
  if (entry) {
    clearTimeout(entry.timeout);
    undoTimers.delete(executionId);
    return true;
  }
  return false;
}

export function getUndoDeadline(executionId: string): number | null {
  return undoTimers.get(executionId)?.deadline ?? null;
}

export function getRemainingMs(executionId: string): number {
  const deadline = getUndoDeadline(executionId);
  if (!deadline) return 0;
  return Math.max(0, deadline - Date.now());
}
