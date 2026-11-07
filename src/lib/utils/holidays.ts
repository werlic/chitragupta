import { prisma } from '@/lib/db';
import { formatLocalDate } from './timezone';

export async function isHoliday(dateStr: string): Promise<boolean> {
  const holiday = await prisma.holiday.findUnique({
    where: { date: dateStr },
  });
  return holiday?.isPublicHoliday ?? false;
}

export async function getHoliday(dateStr: string) {
  return prisma.holiday.findUnique({
    where: { date: dateStr },
  });
}

/**
 * Get the next business day (Mon–Fri, non-holiday) after the given date.
 * Uses local date components (formatLocalDate) instead of toISOString()
 * to avoid UTC timezone shift that moves the date backwards in WIB (UTC+7).
 */
export async function getNextBusinessDay(dateStr: string): Promise<string> {
  const date = new Date(dateStr + 'T00:00:00');
  for (let i = 0; i < 30; i++) {
    date.setDate(date.getDate() + 1);
    const nextStr = formatLocalDate(date);
    const isHol = await isHoliday(nextStr);
    const day = date.getDay();
    // Skip Sunday (0) and Saturday (6) — Indonesian work week
    if (!isHol && day !== 0 && day !== 6) {
      return nextStr;
    }
  }
  return dateStr;
}

export async function getAllHolidays(): Promise<{ date: string; name: string; type: string }[]> {
  const holidays = await prisma.holiday.findMany({
    orderBy: { date: 'asc' },
  });
  return holidays.map((h) => ({ date: h.date, name: h.name, type: h.type }));
}
