import rulesData from '../../../data/datapack/rules.json';
import type { ActionCandidate, RuleWarning } from './types';
import { isHoliday, getNextBusinessDay } from '@/lib/utils/holidays';
import { isFriday, multiZoneDisplay, getDayOfWeek } from '@/lib/utils/timezone';
import { prisma } from '@/lib/db';
import { convertTime, explicitZone, zoneOffset, zonesForCandidate, type Zone } from './zones';

// Fallbacks come from data/datapack/rules.json (used when the WorkRule table is empty/unavailable)
const FILE_RULES = {
  fridayPrayerStart: rulesData.fridayPrayer.blockStart,
  fridayPrayerEnd: rulesData.fridayPrayer.blockEnd,
  fridayPrayerBufferMinutes: Number((rulesData.fridayPrayer as { bufferMinutes?: number }).bufferMinutes ?? 0),
  workStart: rulesData.workHours.default.start,
  workEnd: rulesData.workHours.default.end,
  avoidHolidays: rulesData.reminderRules.avoidHolidays,
  avoidFridayPrayer: rulesData.reminderRules.avoidFridayPrayerBlock,
  avoidOutsideWorkHours: rulesData.reminderRules.avoidOutsideWorkHours,
};

/**
 * Rule configuration loaded from DB (WorkRule model).
 * Cached per pipeline run to avoid N+1 queries.
 */
interface RuleConfig {
  fridayPrayerStart: string;
  fridayPrayerEnd: string;
  fridayPrayerBufferMinutes: number;
  workStart: string;
  workEnd: string;
  avoidHolidays: boolean;
  avoidFridayPrayer: boolean;
  avoidOutsideWorkHours: boolean;
}

export interface RuleContext {
  // Contact rows (name, timezone, email, phone); loaded from DB when omitted
  contacts?: Array<{ name: string; timezone: string; email?: string | null; phone?: string | null }>;
  participants?: string[];
  creatorTimezone?: string;
}

/**
 * Load rule configuration from WorkRule table once per pipeline run.
 * Falls back to rules.json if DB is unavailable or a key is missing.
 */
async function loadRuleConfig(): Promise<RuleConfig> {
  try {
    const rules = await prisma.workRule.findMany();
    const ruleMap: Record<string, string> = {};
    for (const r of rules) {
      ruleMap[r.key] = r.value;
    }
    const buffer = Number(ruleMap['fridayPrayer.bufferMinutes']);

    return {
      fridayPrayerStart: ruleMap['fridayPrayer.blockStart'] || FILE_RULES.fridayPrayerStart,
      fridayPrayerEnd: ruleMap['fridayPrayer.blockEnd'] || FILE_RULES.fridayPrayerEnd,
      fridayPrayerBufferMinutes: Number.isFinite(buffer) && ruleMap['fridayPrayer.bufferMinutes'] ? buffer : FILE_RULES.fridayPrayerBufferMinutes,
      workStart: ruleMap['workHours.default.start'] || FILE_RULES.workStart,
      workEnd: ruleMap['workHours.default.end'] || FILE_RULES.workEnd,
      avoidHolidays: ruleMap['reminder.avoidHolidays'] !== 'false',
      avoidFridayPrayer: ruleMap['reminder.avoidFridayPrayer'] !== 'false',
      avoidOutsideWorkHours: ruleMap['reminder.avoidOutsideWorkHours'] !== 'false',
    };
  } catch {
    return { ...FILE_RULES };
  }
}

/**
 * Interpret "Jumat siang/pagi/sore" — map vague Friday time references
 * to concrete suggestions based on work hours and Friday prayer block.
 *
 * - "Jumat siang" → after prayer block + buffer (13:00 + 30 menit = 13:30)
 * - "Jumat pagi"  → workStart (default 08:00, before prayer block)
 * - "Jumat sore"  → 1 hour before work ends (15:00)
 */
function resolveFridayVagueTime(vagueRef: string, config: RuleConfig): string | null {
  const lower = vagueRef.toLowerCase();
  if (lower.includes('siang')) return afterPrayer(config);
  if (lower.includes('pagi')) return config.workStart;
  if (lower.includes('sore')) return addMinutes(config.workEnd, -60);
  return null;
}

function afterPrayer(config: RuleConfig): string {
  return addMinutes(config.fridayPrayerEnd, config.fridayPrayerBufferMinutes);
}

/** Shift "HH:MM" by minutes (wraps around midnight). */
function addMinutes(timeStr: string, minutes: number): string {
  const [h, m] = timeStr.split(':').map(Number);
  const total = (((h * 60 + m + minutes) % 1440) + 1440) % 1440;
  return `${String(Math.floor(total / 60)).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`;
}

async function loadContacts(ctx: RuleContext): Promise<NonNullable<RuleContext['contacts']>> {
  if (ctx.contacts) return ctx.contacts;
  try {
    return await prisma.contact.findMany();
  } catch {
    return [];
  }
}

export async function checkRules(candidates: ActionCandidate[], ctx: RuleContext = {}): Promise<RuleWarning[]> {
  const warnings: RuleWarning[] = [];
  const config = await loadRuleConfig();
  const contacts = await loadContacts(ctx);

  for (const c of candidates) {
    if (!c.dueDate) continue;

    // Rule 1: Holiday check
    if (config.avoidHolidays && (await isHoliday(c.dueDate))) {
      const nextDay = await getNextBusinessDay(c.dueDate);
      warnings.push({
        type: 'holiday',
        candidateId: c.id,
        message: `Tanggal ${c.dueDate} adalah hari libur nasional. Disarankan pindah ke ${nextDay}.`,
        suggestedDate: nextDay,
      });
    }

    // Rule 2: Weekend check
    const day = getDayOfWeek(c.dueDate);
    if (day === 'Saturday' || day === 'Sunday') {
      const nextDay = await getNextBusinessDay(c.dueDate);
      warnings.push({
        type: 'weekend',
        candidateId: c.id,
        message: `${c.dueDate} adalah ${day}. Hari kerja Indonesia adalah Senin-Jumat. Disarankan ${nextDay}.`,
        suggestedDate: nextDay,
      });
    }

    // Time the remaining rules look at (Friday suggestion applied, see applyRuleSuggestions)
    let time = c.dueTime || undefined;

    // Rule 3: Friday prayer block + "Jumat siang/pagi/sore" interpretation.
    // The suggestion is APPLIED to the plan (applied: true) so the approved hash carries it.
    if (isFriday(c.dueDate) && config.avoidFridayPrayer) {
      const blockLabel = `${config.fridayPrayerStart}-${config.fridayPrayerEnd}`;
      const bufferLabel = config.fridayPrayerBufferMinutes > 0 ? ` + jeda ${config.fridayPrayerBufferMinutes} menit` : '';
      if (time && time >= config.fridayPrayerStart && time < config.fridayPrayerEnd) {
        const suggested = afterPrayer(config);
        warnings.push({
          type: 'friday_prayer',
          candidateId: c.id,
          message: `Waktu ${time} jatuh pada blok salat Jumat (${blockLabel}). Diusulkan agent: ${suggested} WIB (setelah salat${bufferLabel}).`,
          suggestedTime: suggested,
          applied: true,
        });
        time = suggested;
      } else if (!time) {
        const resolved = resolveFridayVagueTime(`${c.title} ${c.evidenceQuote}`, config);
        if (resolved) {
          warnings.push({
            type: 'friday_prayer',
            candidateId: c.id,
            message: `Tindakan menyebut "Jumat" tanpa jam spesifik. Diusulkan agent: ${resolved} WIB (di luar blok salat Jumat ${blockLabel}${bufferLabel}).`,
            suggestedTime: resolved,
            applied: true,
          });
          time = resolved;
        }
      }
    }

    // Reference zone of the time: written in the action ("15:30 WITA") else WIB
    const refZone: Zone = explicitZone(`${c.title} ${c.evidenceQuote}`) || 'WIB';

    // Rule 4: Outside work hours (in the reference zone)
    if (time && config.avoidOutsideWorkHours && (time < config.workStart || time >= config.workEnd)) {
      warnings.push({
        type: 'outside_work_hours',
        candidateId: c.id,
        message: `Waktu ${time} di luar jam kerja (${config.workStart}-${config.workEnd} ${refZone}). Disarankan ${config.workStart}.`,
        suggestedTime: config.workStart,
      });
    }

    // Rule 4b: Outside work hours for anyone involved in another zone (15:30 WIB = 17:30 WIT)
    if (time && config.avoidOutsideWorkHours) {
      const zones = zonesForCandidate(c, contacts, ctx.participants, ctx.creatorTimezone);
      zones.add(refZone);
      const outside = [...zones].filter((z) => {
        if (z === refZone) return false;
        const local = convertTime(time!, refZone, z);
        return local < config.workStart || local >= config.workEnd;
      });
      if (outside.length > 0) {
        const suggested = commonWorkSlot([...zones], refZone, time, config);
        const locals = outside.map((z) => `${convertTime(time!, refZone, z)} ${z}`).join(', ');
        warnings.push({
          type: 'timezone_mismatch',
          candidateId: c.id,
          message:
            `Waktu ${time} ${refZone} = ${locals}, di luar jam kerja (${config.workStart}-${config.workEnd}) pihak di zona ${outside.join('/')}.` +
            (suggested ? ` Disarankan ${suggested} ${refZone}.` : ' Tidak ada jam kerja yang sama untuk semua zona.'),
          ...(suggested ? { suggestedTime: suggested } : {}),
        });
      }
    }

    // Rule 5: Timezone awareness (if location implies different zone)
    if (c.location && time) {
      const zoneWarnings = checkTimezone(c.location, time);
      if (zoneWarnings) {
        warnings.push({
          type: 'timezone_mismatch',
          candidateId: c.id,
          message: zoneWarnings,
        });
      }
    }
  }

  return warnings;
}

/**
 * Put applied suggestions (friday_prayer, applied: true) into the candidates themselves,
 * so the plan shown, stored and hashed for approval carries the suggested time.
 */
export function applyRuleSuggestions(candidates: ActionCandidate[], warnings: RuleWarning[]): ActionCandidate[] {
  return candidates.map((c) => {
    const w = warnings.find((x) => x.candidateId === c.id && x.applied && x.suggestedTime);
    return w ? { ...c, dueTime: w.suggestedTime } : c;
  });
}

/**
 * Latest 1-hour slot (in refZone) inside everyone's work hours, or the earliest one
 * when the requested time is before the common window. null when no overlap.
 */
function commonWorkSlot(zones: Zone[], refZone: Zone, time: string, config: RuleConfig): string | null {
  const toMin = (t: string) => {
    const [h, m] = t.split(':').map(Number);
    return h * 60 + m;
  };
  let start = 0;
  let end = 1440;
  for (const z of zones) {
    const shift = (zoneOffset(z) - zoneOffset(refZone)) * 60;
    start = Math.max(start, toMin(config.workStart) - shift);
    end = Math.min(end, toMin(config.workEnd) - shift);
  }
  if (end - start < 60) return null;
  const at = toMin(time) < start ? start : end - 60;
  return addMinutes('00:00', at);
}

function checkTimezone(location: string, time: string): string | null {
  const locLower = location.toLowerCase();
  let zone: 'WIB' | 'WITA' | 'WIT' | null = null;

  if (['jakarta', 'bandung', 'surabaya', 'medan', 'semarang'].some((c) => locLower.includes(c))) {
    zone = 'WIB';
  } else if (['denpasar', 'bali', 'makassar', 'balikpapan'].some((c) => locLower.includes(c))) {
    zone = 'WITA';
  } else if (['jayapura', 'ambon', 'sorong'].some((c) => locLower.includes(c))) {
    zone = 'WIT';
  }

  if (zone && zone !== 'WIB') {
    return `Lokasi ${location} ada di zona ${zone}. Waktu ${time} WIB = ${multiZoneDisplay(time, 'WIB')}`;
  }

  return null;
}
