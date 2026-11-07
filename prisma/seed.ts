import { PrismaClient, Role } from '@prisma/client';
import bcrypt from 'bcryptjs';
import { readFileSync, readdirSync } from 'fs';
import { join } from 'path';

const prisma = new PrismaClient();

// Data Pack loader — reads from data/datapack/*.json
const DATAPACK_DIR = join(__dirname, '..', 'data', 'datapack');

function loadJson<T>(filename: string): T {
  const filePath = join(DATAPACK_DIR, filename);
  const raw = readFileSync(filePath, 'utf-8');
  return JSON.parse(raw) as T;
}

interface DatapackContact {
  id: string; name: string; role: string; timezone: string; location: string;
  email: string; phone: string; department: string;
}
interface DatapackExternal {
  id: string; name: string; email: string; phone?: string; isExternal: true;
  timezone: string; location: string;
}
interface DatapackContacts {
  contacts: DatapackContact[];
  externalContacts: DatapackExternal[];
}
interface DatapackHoliday {
  date: string; name: string; type: string; isPublicHoliday: boolean;
}
interface DatapackHolidays { holidays: DatapackHoliday[] }
interface DatapackRules {
  timeZones: Record<string, { name: string; utcOffset: number; cities: string[] }>;
  workHours: {
    default: { start: string; end: string; lunchBreak: { start: string; end: string }; timezone: string };
    shift1: { start: string; end: string; lunchBreak: { start: string; end: string } };
    shift2: { start: string; end: string; lunchBreak: { start: string; end: string } };
  };
  fridayPrayer: { day: string; blockStart: string; blockEnd: string };
  reminderRules: { avoidHolidays: boolean; avoidFridayPrayerBlock: boolean; avoidOutsideWorkHours: boolean; suggestAlternative: boolean };
}

async function main() {
  console.log('🌱 Seeding database from Data Pack...');

  // Clean existing data
  await prisma.chatMessage.deleteMany();
  await prisma.channelMember.deleteMany();
  await prisma.chatChannel.deleteMany();
  await prisma.executionRecord.deleteMany();
  await prisma.idempotencyKey.deleteMany();
  await prisma.actionCandidate.deleteMany();
  await prisma.auditLog.deleteMany();
  await prisma.meeting.deleteMany();
  await prisma.workRule.deleteMany();
  await prisma.holiday.deleteMany();
  await prisma.contact.deleteMany();
  await prisma.user.deleteMany();

  // ============ LOAD DATA PACK ============
  const contactsData = loadJson<DatapackContacts>('contacts.json');
  const holidaysData = loadJson<DatapackHolidays>('holidays.json');
  const rulesData = loadJson<DatapackRules>('rules.json');

  console.log(`  📁 Loaded Data Pack: ${contactsData.contacts.length} contacts, ${contactsData.externalContacts.length} external, ${holidaysData.holidays.length} holidays`);

  // ============ USERS (5 roles) ============
  const password = await bcrypt.hash('password123', 10);

  // Map contacts to users — first 5 internal contacts become users
  const admin = await prisma.user.create({
    data: {
      email: 'admin@company.id',
      password,
      name: 'System Admin',
      role: Role.ADMIN,
      timezone: 'WIB',
      location: 'Jakarta',
      department: 'IT',
    },
  });

  // Create users from first few contacts
  const directorContact = contactsData.contacts.find(c => c.name === 'Pak Hendra')!;
  const managerContact = contactsData.contacts.find(c => c.name === 'Budi Santoso')!;
  const secretaryContact = contactsData.contacts.find(c => c.name === 'Sari Wijaya')!;
  const staffContact = contactsData.contacts.find(c => c.name === 'Budi Hartono')!;

  const director = await prisma.user.create({
    data: {
      email: directorContact.email,
      password,
      name: directorContact.name,
      role: Role.DIRECTOR,
      timezone: directorContact.timezone,
      location: directorContact.location,
      department: directorContact.department,
      phone: directorContact.phone,
    },
  });

  const manager = await prisma.user.create({
    data: {
      email: managerContact.email,
      password,
      name: managerContact.name,
      role: Role.MANAGER,
      timezone: managerContact.timezone,
      location: managerContact.location,
      department: managerContact.department,
      phone: managerContact.phone,
    },
  });

  const secretary = await prisma.user.create({
    data: {
      email: secretaryContact.email,
      password,
      name: secretaryContact.name,
      role: Role.SECRETARY,
      timezone: secretaryContact.timezone,
      location: secretaryContact.location,
      department: secretaryContact.department,
      phone: secretaryContact.phone,
    },
  });

  const staff = await prisma.user.create({
    data: {
      email: staffContact.email,
      password,
      name: staffContact.name,
      role: Role.STAFF,
      timezone: staffContact.timezone,
      location: staffContact.location,
      department: staffContact.department,
      phone: staffContact.phone,
    },
  });

  console.log(`  ✓ Created 5 users (admin, director, manager, secretary, staff)`);

  // ============ CONTACTS (from Data Pack) ============
  // Map contact IDs to user IDs for linking
  const contactToUserId: Record<string, string> = {
    [directorContact.id]: director.id,
    [managerContact.id]: manager.id,
    [secretaryContact.id]: secretary.id,
    [staffContact.id]: staff.id,
  };

  const allContacts = [
    ...contactsData.contacts,
    ...contactsData.externalContacts.map(e => ({ ...e, role: undefined, department: undefined })) as any[],
  ];

  for (const c of allContacts) {
    await prisma.contact.create({
      data: {
        name: c.name,
        role: c.role || null,
        email: c.email,
        phone: c.phone || null,
        timezone: c.timezone,
        location: c.location,
        department: c.department || null,
        isExternal: (c as any).isExternal || false,
        userId: contactToUserId[c.id] || null,
      },
    });
  }

  console.log(`  ✓ Created ${allContacts.length} contacts (${contactsData.contacts.length} internal + ${contactsData.externalContacts.length} external)`);

  // ============ HOLIDAYS (from Data Pack) ============
  await prisma.holiday.createMany({
    data: holidaysData.holidays.map(h => ({
      id: `hol-${h.date}`,
      date: h.date,
      name: h.name,
      type: h.type,
      isPublicHoliday: h.isPublicHoliday,
    })),
  });
  console.log(`  ✓ Created ${holidaysData.holidays.length} holidays (SKB 2026-2027)`);

  // ============ WORK RULES (from Data Pack rules.json) ============
  const rules = [
    { key: 'workHours.default.start', value: rulesData.workHours.default.start, description: 'Default work start time' },
    { key: 'workHours.default.end', value: rulesData.workHours.default.end, description: 'Default work end time' },
    { key: 'workHours.default.lunchStart', value: rulesData.workHours.default.lunchBreak.start, description: 'Lunch break start' },
    { key: 'workHours.default.lunchEnd', value: rulesData.workHours.default.lunchBreak.end, description: 'Lunch break end' },
    { key: 'workHours.default.timezone', value: rulesData.workHours.default.timezone, description: 'Default timezone' },
    { key: 'workHours.shift1.start', value: rulesData.workHours.shift1.start, description: 'Shift 1 start' },
    { key: 'workHours.shift1.end', value: rulesData.workHours.shift1.end, description: 'Shift 1 end' },
    { key: 'workHours.shift2.start', value: rulesData.workHours.shift2.start, description: 'Shift 2 start' },
    { key: 'workHours.shift2.end', value: rulesData.workHours.shift2.end, description: 'Shift 2 end' },
    { key: 'fridayPrayer.day', value: rulesData.fridayPrayer.day, description: 'Day of Friday Prayer' },
    { key: 'fridayPrayer.blockStart', value: rulesData.fridayPrayer.blockStart, description: 'Friday prayer block start' },
    { key: 'fridayPrayer.blockEnd', value: rulesData.fridayPrayer.blockEnd, description: 'Friday prayer block end' },
    { key: 'timezone.WIB.utcOffset', value: String(rulesData.timeZones.WIB.utcOffset), description: 'WIB UTC offset' },
    { key: 'timezone.WITA.utcOffset', value: String(rulesData.timeZones.WITA.utcOffset), description: 'WITA UTC offset' },
    { key: 'timezone.WIT.utcOffset', value: String(rulesData.timeZones.WIT.utcOffset), description: 'WIT UTC offset' },
    { key: 'reminder.avoidHolidays', value: String(rulesData.reminderRules.avoidHolidays), description: 'Avoid scheduling on holidays' },
    { key: 'reminder.avoidFridayPrayer', value: String(rulesData.reminderRules.avoidFridayPrayerBlock), description: 'Avoid Friday prayer block' },
    { key: 'reminder.avoidOutsideWorkHours', value: String(rulesData.reminderRules.avoidOutsideWorkHours), description: 'Avoid outside work hours' },
    { key: 'retention.years', value: '5', description: 'Data retention per UU PDP' },
  ];

  await prisma.workRule.createMany({ data: rules });
  console.log(`  ✓ Created ${rules.length} work rules`);

  // ============ CHAT CHANNELS ============
  const generalChannel = await prisma.chatChannel.create({
    data: {
      name: 'general',
      type: 'GROUP',
      description: 'General team discussion',
      members: {
        create: [
          { userId: admin.id },
          { userId: director.id },
          { userId: manager.id },
          { userId: secretary.id },
          { userId: staff.id },
        ],
      },
    },
  });

  const opsChannel = await prisma.chatChannel.create({
    data: {
      name: 'operations',
      type: 'GROUP',
      description: 'Operations team channel',
      members: {
        create: [
          { userId: admin.id },
          { userId: manager.id },
          { userId: secretary.id },
        ],
      },
    },
  });

  // AI assistant channel — shared for now, will create per-user on first chat
  await prisma.chatChannel.create({
    data: {
      name: 'AI Assistant',
      type: 'AI',
      description: 'Chat with AI assistant about meetings and tasks',
      members: {
        create: [
          { userId: manager.id },
          { userId: secretary.id },
        ],
      },
    },
  });

  // Seed some messages in general
  await prisma.chatMessage.createMany({
    data: [
      {
        channelId: generalChannel.id,
        userId: manager.id,
        senderName: 'Budi Santoso',
        senderRole: 'MANAGER',
        content: 'Selamat pagi semua! Rapat operasional besok jam 9 pagi ya.',
      },
      {
        channelId: generalChannel.id,
        userId: secretary.id,
        senderName: 'Sari Wijaya',
        senderRole: 'SECRETARY',
        content: 'Siap Pak, saya akan kirim undangan dan notulen setelah rapat.',
      },
      {
        channelId: generalChannel.id,
        userId: staff.id,
        senderName: 'Budi Hartono',
        senderRole: 'STAFF',
        content: 'Mohon maaf saya dari Denpasar, bisa ikut via video call?',
      },
    ],
  });

  console.log(`  ✓ Created 3 chat channels + seed messages`);
  console.log('\n✅ Seed complete! Data loaded from data/datapack/');
  console.log('\n📋 Demo accounts (password: password123):');
  console.log('  Admin      → admin@company.id');
  console.log('  Director   → hendra@company.id');
  console.log('  Manager    → budi.santoso@company.id');
  console.log('  Secretary  → sari.wijaya@company.id');
  console.log('  Staff      → budi.hartono@company.id');
}

main()
  .catch((e) => {
    console.error('❌ Seed error:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
