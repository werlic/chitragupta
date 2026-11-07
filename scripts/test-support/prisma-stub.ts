/**
 * In-memory Prisma stub for DB-free tests (B1 test suite).
 * Install it on globalThis.prisma BEFORE any app module is required:
 * src/lib/db.ts reuses globalThis.prisma when it exists.
 *
 * Seeded from data/datapack/ (contacts, holidays, rules) the same way
 * prisma/seed.ts maps them. Only the query shapes used by src/lib/** are
 * supported (where equality / { in } / { contains, mode }, orderBy, take).
 */
import { readFileSync } from 'fs';
import { join } from 'path';

type Row = Record<string, any>;

const DATAPACK = join(process.cwd(), 'data', 'datapack');
const loadJson = (f: string) => JSON.parse(readFileSync(join(DATAPACK, f), 'utf8'));

let seq = 0;
const newId = (prefix: string) => `${prefix}_${(++seq).toString(36)}_${Date.now().toString(36)}`;

function matches(row: Row, where: Row | undefined, table?: string): boolean {
  if (!where) return true;
  for (const [key, cond] of Object.entries(where)) {
    if (key === 'AND') { if (!(cond as Row[]).every((w) => matches(row, w, table))) return false; continue; }
    if (key === 'OR') { if (!(cond as Row[]).some((w) => matches(row, w, table))) return false; continue; }
    // Relation filter, e.g. actionCandidate { meeting: { creatorId } }
    // Has-many filter, e.g. chatChannel { members: { some: { userId }, every: { userId } } }
    const many = table ? HAS_MANY[table]?.[key] : undefined;
    if (many && cond !== null && typeof cond === 'object') {
      const children = (registry[many[0]]?.rows || []).filter((r) => r[many[1]] === row.id);
      const c = cond as Row;
      if ('some' in c && !children.some((ch) => matches(ch, c.some, many[0]))) return false;
      if ('every' in c && !children.every((ch) => matches(ch, c.every, many[0]))) return false;
      if ('none' in c && children.some((ch) => matches(ch, c.none, many[0]))) return false;
      continue;
    }
    const rel = table ? RELATIONS[table]?.[key] : undefined;
    if (rel && cond !== null && typeof cond === 'object' && !Array.isArray(cond)) {
      const target = registry[rel[0]]?.rows.find((r) => r[rel[2]] === row[rel[1]]);
      if (!target || !matches(target, cond as Row, rel[0])) return false;
      continue;
    }
    const val = row[key];
    if (cond !== null && typeof cond === 'object' && !(cond instanceof Date) && !Array.isArray(cond)) {
      if ('in' in cond && !(cond.in as unknown[]).includes(val)) return false;
      if ('notIn' in cond && (cond.notIn as unknown[]).includes(val)) return false;
      if ('equals' in cond && val !== cond.equals) return false;
      if ('not' in cond && val === cond.not) return false;
      if ('contains' in cond) {
        const insensitive = cond.mode === 'insensitive';
        const hay = String(val ?? '');
        const needle = String(cond.contains);
        if (!(insensitive ? hay.toLowerCase().includes(needle.toLowerCase()) : hay.includes(needle))) return false;
      }
      if ('gte' in cond && !(val >= cond.gte)) return false;
      if ('lte' in cond && !(val <= cond.lte)) return false;
      if ('gt' in cond && !(val > cond.gt)) return false;
      if ('lt' in cond && !(val < cond.lt)) return false;
      continue;
    }
    if (val !== cond) return false;
  }
  return true;
}

const clone = <T>(x: T): T => (x === null || x === undefined ? x : JSON.parse(JSON.stringify(x), reviveDates));
function reviveDates(_k: string, v: unknown) {
  return typeof v === 'string' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(v) ? new Date(v) : v;
}

/** Relations used by src/ via `include`: table -> field -> [target table, local fk, target key] */
const RELATIONS: Record<string, Record<string, [string, string, string]>> = {
  executionRecord: { candidate: ['actionCandidate', 'candidateId', 'id'] },
  actionCandidate: { meeting: ['meeting', 'meetingId', 'id'], assignee: ['user', 'assigneeId', 'id'] },
  meeting: { creator: ['user', 'creatorId', 'id'] },
  idempotencyKey: {},
};
/** Has-many relations: table -> field -> [child table, child fk] (filters and nested create) */
const HAS_MANY: Record<string, Record<string, [string, string]>> = {
  chatChannel: { members: ['channelMember', 'channelId'], messages: ['chatMessage', 'channelId'] },
};
let registry: Record<string, Table> = {};

export class Table {
  rows: Row[] = [];
  constructor(public name: string, private defaults: () => Row = () => ({})) {}

  withInclude(row: Row, include?: Row): Row {
    const out = clone(row);
    if (!include) return out;
    for (const field of Object.keys(include)) {
      const rel = RELATIONS[this.name]?.[field];
      if (rel) {
        const target = registry[rel[0]]?.rows.find((r) => r[rel[2]] === row[rel[1]]);
        // Nested include/select: only relation keys matter (scalar selects return the full row)
        const spec = include[field];
        const nested = spec && typeof spec === 'object' ? (spec.include || spec.select) : undefined;
        out[field] = target ? registry[rel[0]].withInclude(target, nested) : null;
      } else {
        // has-many: rows of a table whose fk points back here (e.g. meeting.candidates)
        const many: Record<string, [string, string]> = { candidates: ['actionCandidate', 'meetingId'], executionRecords: ['executionRecord', 'candidateId'], auditLogs: ['auditLog', 'meetingId'] };
        const m = many[field];
        if (m) out[field] = (registry[m[0]]?.rows || []).filter((r) => r[m[1]] === row.id).map(clone);
      }
    }
    return out;
  }

  async create({ data }: { data: Row }) {
    // Nested create on a has-many field: members: { create: [{ userId }] }
    const nested: Array<[string, string, Row[]]> = [];
    const own: Row = {};
    for (const [k, v] of Object.entries(data)) {
      const many = HAS_MANY[this.name]?.[k];
      if (many && v && typeof v === 'object' && 'create' in (v as Row)) {
        const list = (v as Row).create;
        nested.push([many[0], many[1], Array.isArray(list) ? list : [list]]);
      } else own[k] = v;
    }
    const row = { id: newId(this.name), createdAt: new Date(), updatedAt: new Date(), ...this.defaults(), ...own };
    this.rows.push(row);
    for (const [table, fk, list] of nested) {
      for (const child of list) await registry[table].create({ data: { ...child, [fk]: row.id } });
    }
    return clone(row);
  }
  async createMany({ data }: { data: Row[] }) {
    for (const d of data) await this.create({ data: d });
    return { count: data.length };
  }
  async findMany(args: { where?: Row; orderBy?: Row; take?: number; select?: Row; include?: Row } = {}) {
    let out = this.rows.filter((r) => matches(r, args.where, this.name));
    if (args.orderBy) {
      const [k, dir] = Object.entries(args.orderBy)[0];
      out = [...out].sort((a, b) => (a[k] < b[k] ? -1 : a[k] > b[k] ? 1 : 0) * (dir === 'desc' ? -1 : 1));
    }
    if (args.take) out = out.slice(0, args.take);
    return out.map((r) => this.withInclude(r, args.include));
  }
  async findUnique({ where, include }: { where: Row; include?: Row }) {
    const r = this.rows.find((x) => matches(x, where, this.name));
    return r ? this.withInclude(r, include) : null;
  }
  async findFirst(args: { where?: Row; include?: Row } = {}) {
    const r = this.rows.find((x) => matches(x, args.where, this.name));
    return r ? this.withInclude(r, args.include) : null;
  }
  async update({ where, data }: { where: Row; data: Row }) {
    const r = this.rows.find((x) => matches(x, where, this.name));
    if (!r) throw new Error(`[prisma-stub] ${this.name}.update: record not found ${JSON.stringify(where)}`);
    Object.assign(r, data, { updatedAt: new Date() });
    return clone(r);
  }
  async updateMany({ where, data }: { where?: Row; data: Row }) {
    const rs = this.rows.filter((x) => matches(x, where, this.name));
    for (const r of rs) Object.assign(r, data, { updatedAt: new Date() });
    return { count: rs.length };
  }
  async upsert({ where, create, update }: { where: Row; create: Row; update: Row }) {
    const r = this.rows.find((x) => matches(x, where, this.name));
    if (r) { Object.assign(r, update); return clone(r); }
    return this.create({ data: create });
  }
  async delete({ where }: { where: Row }) {
    const i = this.rows.findIndex((x) => matches(x, where, this.name));
    if (i < 0) throw new Error(`[prisma-stub] ${this.name}.delete: not found`);
    return clone(this.rows.splice(i, 1)[0]);
  }
  async deleteMany(args: { where?: Row } = {}) {
    const before = this.rows.length;
    this.rows = this.rows.filter((x) => !matches(x, args.where, this.name));
    return { count: before - this.rows.length };
  }
  async count(args: { where?: Row } = {}) {
    return this.rows.filter((r) => matches(r, args.where, this.name)).length;
  }
}

export interface PrismaStub {
  contact: Table;
  holiday: Table;
  workRule: Table;
  user: Table;
  meeting: Table;
  actionCandidate: Table;
  auditLog: Table;
  executionRecord: Table;
  idempotencyKey: Table;
  chatMessage: Table;
  chatChannel: Table;
  channelMember: Table;
  $transaction: (arg: any) => Promise<any>;
  $connect: () => Promise<void>;
  $disconnect: () => Promise<void>;
  __reset: () => void;
}

export function contactsFromDatapack(): Row[] {
  const data = loadJson('contacts.json');
  return [
    ...data.contacts.map((c: Row) => ({ ...c, isExternal: false, userId: null })),
    ...(data.externalContacts || []).map((c: Row) => ({ ...c, role: null, department: null, isExternal: true, userId: null })),
  ];
}

function seedRows(stub: PrismaStub) {
  stub.contact.rows = contactsFromDatapack().map((c) => ({ createdAt: new Date(), ...c }));
  stub.holiday.rows = loadJson('holidays.json').holidays.map((h: Row, i: number) => ({
    id: `hol_${i}`,
    date: h.date,
    name: h.name,
    type: h.type,
    isPublicHoliday: h.isPublicHoliday ?? true,
  }));
  const r = loadJson('rules.json');
  const rules: Array<[string, string]> = [
    ['workHours.default.start', r.workHours.default.start],
    ['workHours.default.end', r.workHours.default.end],
    ['workHours.default.lunchStart', r.workHours.default.lunchBreak.start],
    ['workHours.default.lunchEnd', r.workHours.default.lunchBreak.end],
    ['workHours.default.timezone', r.workHours.default.timezone],
    ['fridayPrayer.day', r.fridayPrayer.day],
    ['fridayPrayer.blockStart', r.fridayPrayer.blockStart],
    ['fridayPrayer.blockEnd', r.fridayPrayer.blockEnd],
    ['reminder.avoidHolidays', String(r.reminderRules.avoidHolidays)],
    ['reminder.avoidFridayPrayer', String(r.reminderRules.avoidFridayPrayerBlock)],
    ['reminder.avoidOutsideWorkHours', String(r.reminderRules.avoidOutsideWorkHours)],
    ['retention.years', '5'],
  ];
  stub.workRule.rows = rules.map(([key, value], i) => ({ id: `wr_${i}`, key, value }));
  stub.user.rows = [
    { id: 'u-director', name: 'Pak Hendra', role: 'DIRECTOR', timezone: 'WIT' },
    { id: 'u-manager', name: 'Budi Santoso', role: 'MANAGER', timezone: 'WIB' },
    { id: 'u-secretary', name: 'Sari Wijaya', role: 'SECRETARY', timezone: 'WIB' },
    { id: 'u-staff', name: 'Budi Hartono', role: 'STAFF', timezone: 'WITA' },
  ];
}

export function createPrismaStub(): PrismaStub {
  const stub = {
    contact: new Table('contact'),
    holiday: new Table('holiday'),
    workRule: new Table('workRule'),
    user: new Table('user'),
    meeting: new Table('meeting', () => ({ status: 'DRAFT', participants: [], notulen: null, clarifierQuestions: null, clarifierAnswers: null, planHash: null, approvalToken: null })),
    actionCandidate: new Table('actionCandidate', () => ({ status: 'PENDING', recipients: [], isExternal: false, recipientCount: 0, ownerId: null, dueDate: null, dueTime: null, location: null })),
    auditLog: new Table('auditLog'),
    executionRecord: new Table('executionRecord', () => ({ status: 'SUCCESS', executedAt: new Date() })),
    idempotencyKey: new Table('idempotencyKey', () => ({ executionId: null })),
    chatMessage: new Table('chatMessage', () => ({ isAI: false, meta: null, meetingId: null, userId: null, senderRole: null })),
    chatChannel: new Table('chatChannel', () => ({ type: 'GROUP', description: null })),
    channelMember: new Table('channelMember', () => ({ joinedAt: new Date() })),
    $transaction: async (arg: any) => (typeof arg === 'function' ? arg(stub) : Promise.all(arg)),
    $connect: async () => {},
    $disconnect: async () => {},
    __reset: () => {
      for (const t of ['meeting', 'actionCandidate', 'auditLog', 'executionRecord', 'idempotencyKey', 'chatMessage', 'chatChannel', 'channelMember'] as const) {
        (stub as any)[t].rows = [];
      }
      seedRows(stub as PrismaStub);
    },
  } as PrismaStub;
  registry = stub as unknown as Record<string, Table>;
  stub.__reset();
  return stub;
}
