/**
 * Message templates for the mock tools. Pure (no server imports) so the Review
 * preview can render exactly the text that will be "sent".
 */

/** "Pak Budi" → "Bapak Budi", "Bu Sari" → "Ibu Sari", otherwise "Bapak/Ibu <nama>". */
export function salutation(name: string): string {
  const n = (name || '').trim();
  const m = n.match(/^(pak|bapak|bu|ibu)\.?\s+(.+)$/i);
  if (m) return `${/^(pak|bapak)$/i.test(m[1]) ? 'Bapak' : 'Ibu'} ${m[2]}`;
  return n ? `Bapak/Ibu ${n}` : 'Bapak/Ibu';
}

export function emailBody(input: { owner: string; title: string; dueDate?: string | null; meetingTitle?: string | null }): string {
  const greeting = `Yth. ${salutation(input.owner)},`;
  const isMinutes = /notulen|minutes|\bmom\b/i.test(input.title);
  const line = isMinutes
    ? `Terlampir notulen ${input.meetingTitle || 'rapat'}.`
    : `${input.title.replace(/[.\s]+$/, '')}${input.dueDate ? ` (jatuh tempo ${input.dueDate})` : ''}.`;
  return `${greeting}\n\n${line}\n\nTerima kasih.`;
}
