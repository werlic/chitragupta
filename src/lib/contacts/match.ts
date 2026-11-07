const HONORIFIC = /^(Pak|Bu|Bapak|Ibu)\s+/i;

function words(name: string): string[] {
  return name.replace(HONORIFIC, '').trim().toLowerCase().split(/\s+/).filter(Boolean);
}

/**
 * Match a spoken/written name to contacts (shared by clarifier and recipient resolver).
 * 1. Exact full-name match wins ("Budi Santoso").
 * 2. Otherwise every token of the name must be a whole word of the contact name.
 * 3. A single-token name that matches several contacts prefers contacts whose FIRST name
 *    equals it, so "Bu Sari" -> Sari Wijaya (not Maya Sari), while "Pak Budi" still
 *    returns both Budi Santoso and Budi Hartono.
 */
export function matchContactsByName<T extends { name: string }>(contacts: T[], name: string): T[] {
  const tokens = words(name);
  if (tokens.length === 0) return [];
  const key = tokens.join(' ');

  const exact = contacts.filter(c => words(c.name).join(' ') === key);
  if (exact.length > 0) return exact;

  const matches = contacts.filter(c => {
    const w = words(c.name);
    return tokens.every(t => w.includes(t));
  });

  if (tokens.length === 1 && matches.length > 1) {
    const byFirstName = matches.filter(c => words(c.name)[0] === tokens[0]);
    if (byFirstName.length > 0) return byFirstName;
  }
  return matches;
}
