export const DAY_NAMES = ['minggu', 'senin', 'selasa', 'rabu', 'kamis', 'jumat', 'sabtu'];

const MONTHS: Record<string, number> = {
  januari: 1, jan: 1, january: 1,
  februari: 2, feb: 2, peb: 2, february: 2,
  maret: 3, mar: 3, march: 3,
  april: 4, apr: 4,
  mei: 5, may: 5,
  juni: 6, jun: 6, june: 6,
  juli: 7, jul: 7, july: 7,
  agustus: 8, agu: 8, agt: 8, aug: 8, august: 8,
  september: 9, sep: 9, sept: 9,
  oktober: 10, okt: 10, oct: 10, october: 10,
  november: 11, nov: 11, nopember: 11,
  desember: 12, des: 12, dec: 12, december: 12,
};

function toDateStr(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function addDays(today: Date, n: number): string {
  const d = new Date(today);
  d.setDate(d.getDate() + n);
  return toDateStr(d);
}

function validDate(y: number, m: number, day: number): string | undefined {
  const d = new Date(y, m - 1, day);
  if (d.getFullYear() !== y || d.getMonth() !== m - 1 || d.getDate() !== day) return undefined;
  return toDateStr(d);
}

/** Year left out ("4 November"): this year, or next year once that date has passed. */
function withYear(m: number, day: number, today: Date): string | undefined {
  const thisYear = validDate(today.getFullYear(), m, day);
  if (thisYear && thisYear >= toDateStr(today)) return thisYear;
  return validDate(today.getFullYear() + 1, m, day);
}

/**
 * A calendar date written out: "2026-11-04", "4/11/2026", "4-11-26", "4 November 2026", "4 Nov".
 * Day comes before month, as Indonesians write it. Returns the matched text so callers
 * can keep it out of the clock-time parse ("04.11.2026" is not 04:11).
 */
export function parseExplicitDate(text: string, today: Date = new Date()): { dueDate: string; match: string } | undefined {
  const lower = text.toLowerCase();

  const iso = lower.match(/\b(\d{4})-(\d{1,2})-(\d{1,2})\b/);
  if (iso) {
    const d = validDate(Number(iso[1]), Number(iso[2]), Number(iso[3]));
    if (d) return { dueDate: d, match: iso[0] };
  }

  const numeric = lower.match(/\b(\d{1,2})[/.-](\d{1,2})[/.-](\d{2}|\d{4})\b/);
  if (numeric) {
    const y = numeric[3].length === 2 ? 2000 + Number(numeric[3]) : Number(numeric[3]);
    const d = validDate(y, Number(numeric[2]), Number(numeric[1]));
    if (d) return { dueDate: d, match: numeric[0] };
  }

  const monthNames = Object.keys(MONTHS).sort((a, b) => b.length - a.length).join('|');
  const named = lower.match(new RegExp(`\\b(\\d{1,2})\\s+(${monthNames})\\.?(?:\\s+(\\d{4}))?\\b`));
  if (named) {
    const m = MONTHS[named[2]];
    const day = Number(named[1]);
    const d = named[3] ? validDate(Number(named[3]), m, day) : withYear(m, day, today);
    if (d) return { dueDate: d, match: named[0] };
  }

  return undefined;
}

/** "hari ini" / "besok" / "lusa", then the next occurrence of a day name. */
function relativeDates(lower: string, today: Date): { relative?: string; dayName?: string } {
  let relative: string | undefined;
  if (/\bhari ini\b/.test(lower)) relative = addDays(today, 0);
  else if (/\bbesok\b/.test(lower)) relative = addDays(today, 1);
  else if (/\blusa\b/.test(lower)) relative = addDays(today, 2);

  let dayName: string | undefined;
  const dayIdx = DAY_NAMES.findIndex((d) => new RegExp(`\\b${d}\\b`).test(lower));
  if (dayIdx >= 0) dayName = addDays(today, ((dayIdx - today.getDay() + 7) % 7) || 7);

  return { relative, dayName };
}

/**
 * Reads Indonesian date/time hints from user text: a written-out date, then "hari ini"/"besok"/"lusa",
 * then a day name (next occurrence); HH:MM / "jam 12" / "pukul 12.30" / "jam 3 sore", and pagi/siang/sore.
 * Used to fill fields an LLM left empty, so rule checks (work hours, Friday prayer) still see the time the user said.
 */
export function inferDateTime(text: string, today: Date = new Date()): { dueDate?: string; dueTime?: string } {
  let lower = text.toLowerCase().replace(/jum'at/g, 'jumat');
  const result: { dueDate?: string; dueTime?: string } = {};

  const explicit = parseExplicitDate(lower, today);
  if (explicit) lower = lower.replace(explicit.match, ' ');
  const { relative, dayName } = relativeDates(lower, today);
  result.dueDate = explicit?.dueDate || relative || dayName;

  // "10:00", "11.45", "jam 12", "pukul 12.30", "jam 3 sore", "jam 1 siang"
  const clock = lower.match(/\b(\d{1,2})[.:](\d{2})\b(?:\s*(pagi|siang|sore|malam))?/);
  const hourOnly = clock ? null : lower.match(/\b(?:jam|pukul)\s+(\d{1,2})\b(?![.:]\d)(?:\s*(pagi|siang|sore|malam))?/);
  if (clock || hourOnly) {
    let h = Number(clock ? clock[1] : hourOnly![1]);
    const m = clock ? Number(clock[2]) : 0;
    const period = clock ? clock[3] : hourOnly![2];
    if ((period === 'sore' || period === 'malam') && h < 12) h += 12;
    else if (period === 'siang' && h <= 5) h += 12; // "jam 1 siang" = 13:00
    if (h <= 23 && m <= 59) result.dueTime = `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
  }
  if (!result.dueTime) {
    if (/\bsiang\b/.test(lower)) result.dueTime = '12:00';
    else if (/\bpagi\b/.test(lower)) result.dueTime = '09:00';
    else if (/\bsore\b/.test(lower)) result.dueTime = '15:00';
  }

  if (!result.dueDate) delete result.dueDate;
  return result;
}

/** Every written-out date in the text (each match removed before looking for the next). */
function allExplicitDates(lower: string, today: Date): { dates: string[]; rest: string } {
  const dates: string[] = [];
  let rest = lower;
  for (let i = 0; i < 10; i++) {
    const found = parseExplicitDate(rest, today);
    if (!found) break;
    dates.push(found.dueDate);
    rest = rest.replace(found.match, ' ');
  }
  return { dates, rest };
}

/**
 * A user's answer to "kapan?": the date it names, or the reason it can't be used.
 * A written-out date wins over a day name ("Kamis, 4 November" → 4 November). An answer
 * naming two different days is refused rather than guessed: two written dates
 * ("5 November atau 6 November"), a "besok"/"lusa" that disagrees with the written date or
 * with another relative word, or two different day names ("Senin atau Selasa").
 * The same date repeated is fine.
 */
export function parseDateAnswer(
  text: string,
  today: Date = new Date()
): { dueDate?: string; dueTime?: string; conflict?: string } {
  const hint = inferDateTime(text, today);
  const lower = text.toLowerCase().replace(/jum'at/g, 'jumat');
  const conflict = (dates: string[]) => ({
    conflict: `Jawaban menyebut dua tanggal berbeda (${[...new Set(dates)].join(' dan ')}). Tulis satu tanggal saja.`,
  });

  const { dates: explicit, rest } = allExplicitDates(lower, today);
  if (new Set(explicit).size > 1) return conflict(explicit);

  const relative: string[] = [];
  if (/\bhari ini\b/.test(rest)) relative.push(addDays(today, 0));
  if (/\bbesok\b/.test(rest)) relative.push(addDays(today, 1));
  if (/\blusa\b/.test(rest)) relative.push(addDays(today, 2));

  if (explicit.length > 0) {
    // Day names are ignored next to a written date (it wins); relative words must agree with it
    const disagree = relative.filter((d) => d !== explicit[0]);
    if (disagree.length > 0) return conflict([...disagree, explicit[0]]);
    return hint;
  }

  const dayNames = DAY_NAMES.filter((d) => new RegExp(`\\b${d}\\b`).test(rest))
    .map((d) => addDays(today, ((DAY_NAMES.indexOf(d) - today.getDay() + 7) % 7) || 7));
  const mentioned = [...relative, ...dayNames];
  if (new Set(mentioned).size > 1) return conflict(mentioned);
  return hint;
}
