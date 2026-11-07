// Indonesia timezone helpers: WIB (UTC+7), WITA (UTC+8), WIT (UTC+9)

export const TIMEZONES = {
  WIB: { name: 'Waktu Indonesia Barat', utcOffset: 7, cities: ['Jakarta', 'Bandung', 'Surabaya', 'Medan', 'Semarang'] },
  WITA: { name: 'Waktu Indonesia Tengah', utcOffset: 8, cities: ['Denpasar', 'Makassar', 'Balikpapan', 'Banjarmasin'] },
  WIT: { name: 'Waktu Indonesia Timur', utcOffset: 9, cities: ['Jayapura', 'Ambon', 'Manokwari', 'Sorong'] },
} as const;

export type TimeZone = keyof typeof TIMEZONES;

export function convertTime(timeStr: string, fromZone: TimeZone, toZone: TimeZone): string {
  // Parse "HH:MM"
  const [h, m] = timeStr.split(':').map(Number);
  const fromOffset = TIMEZONES[fromZone].utcOffset;
  const toOffset = TIMEZONES[toZone].utcOffset;
  const diff = toOffset - fromOffset;
  let newH = h + diff;
  if (newH < 0) newH += 24;
  if (newH >= 24) newH -= 24;
  return `${String(newH).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

export function multiZoneDisplay(timeStr: string, baseZone: TimeZone = 'WIB'): string {
  const wib = baseZone === 'WIB' ? timeStr : convertTime(timeStr, baseZone, 'WIB');
  const wita = convertTime(wib, 'WIB', 'WITA');
  const wit = convertTime(wib, 'WIB', 'WIT');
  return `${wib} WIB / ${wita} WITA / ${wit} WIT`;
}

export function getDayOfWeek(dateStr: string): string {
  const date = new Date(dateStr + 'T00:00:00');
  const days = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
  return days[date.getDay()];
}

export function isFriday(dateStr: string): boolean {
  return getDayOfWeek(dateStr) === 'Friday';
}

/**
 * Format a Date object as YYYY-MM-DD using local date components,
 * avoiding toISOString() which converts to UTC and can shift the date
 * backwards in positive-offset timezones (e.g., WIB UTC+7).
 */
export function formatLocalDate(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

/**
 * Add days to a date string and return the resulting YYYY-MM-DD using local formatting.
 */
export function addDaysLocal(dateStr: string, days: number): string {
  const date = new Date(dateStr + 'T00:00:00');
  date.setDate(date.getDate() + days);
  return formatLocalDate(date);
}
