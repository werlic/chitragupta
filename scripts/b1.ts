/**
 * b1 — CLI gate for Chitragupta (see AGENTS.md).
 *
 *   npm run b1 -- plan --input input/rapat.txt --candidates output/rapat-candidates.json
 *   npm run b1 -- status <meetingId>
 *   npm run b1 -- log <meetingId>
 *
 * Chitragupta extracts candidates; this CLI only feeds them into the deterministic
 * planCandidates() gate and stores a plan awaiting approval. There is deliberately
 * NO approve/execute command: approval happens only in the web app.
 */
import { createHash } from 'crypto';
import { existsSync, promises as fs } from 'fs';
import { join, relative, resolve } from 'path';
import { config as loadEnv } from 'dotenv';
import { z } from 'zod';
import { ActionCandidateSchema, questionCandidateIds, type ActionCandidate } from '@/lib/agent/types';
import { matchContactsByName } from '@/lib/contacts/match';

loadEnv({ quiet: true });

const ROOT = process.cwd();
const OUTPUT_DIR = resolve(ROOT, 'output');
const APP_URL = (process.env.B1_APP_URL || 'http://localhost:3000').replace(/\/$/, '');
const DB_TIMEOUT_MS = 8000;

// Roles that may create a plan (rbac 'meeting:create'), in order of preference
const PLAN_ROLES = ['SECRETARY', 'MANAGER', 'DIRECTOR', 'ADMIN'] as const;

const REFUSED_COMMANDS = new Set(['approve', 'execute', 'exec', 'run', 'undo', 'reject', 'send']);

// ============ ERRORS / EXIT CODES ============

class CliError extends Error {
  constructor(message: string, public exitCode = 1) {
    super(message);
  }
}

const EXIT = { usage: 1, refused: 2, db: 3, validation: 4 } as const;

// ============ CANDIDATE FILE SCHEMA ============

// Same shape as ActionCandidateSchema, with the date/time formats AGENTS.md promises
const CliCandidateSchema = ActionCandidateSchema.extend({
  dueDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'dueDate harus YYYY-MM-DD').optional(),
  dueTime: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'dueTime harus HH:mm (24 jam)').optional(),
}).strict();

const CandidateFileSchema = z.union([
  z.array(CliCandidateSchema),
  z
    .object({
      input: z.string().optional(), // path to the meeting text, relative to the project root
      title: z.string().optional(),
      participants: z.array(z.string()).optional(),
      candidates: z.array(CliCandidateSchema),
    })
    .strict(),
]);

type CandidateFile = z.infer<typeof CandidateFileSchema>;

// ============ ARG PARSING ============

interface Args {
  command?: string;
  positionals: string[];
  flags: Record<string, string | true>;
}

function parseArgs(argv: string[]): Args {
  const positionals: string[] = [];
  const flags: Record<string, string | true> = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '-h') {
      flags.help = true;
    } else if (a.startsWith('--')) {
      const eq = a.indexOf('=');
      if (eq > 0) {
        flags[a.slice(2, eq)] = a.slice(eq + 1);
      } else {
        const next = argv[i + 1];
        if (next !== undefined && !next.startsWith('--')) {
          flags[a.slice(2)] = next;
          i++;
        } else {
          flags[a.slice(2)] = true;
        }
      }
    } else {
      positionals.push(a);
    }
  }
  return { command: positionals.shift(), positionals, flags };
}

function stringFlag(args: Args, name: string): string | undefined {
  const v = args.flags[name];
  if (v === true) throw new CliError(`--${name} butuh nilai.`, EXIT.usage);
  return v;
}

const HELP = `b1 — gerbang CLI untuk Chitragupta (lihat AGENTS.md)

Pemakaian:
  npm run b1 -- <perintah> [opsi]

Perintah:
  segments --input <txt>
      Tampilkan teks rapat per segmen [seg-NN] (tanpa database). Pakai ini untuk
      mengisi sourceSegmentId dan menyalin evidenceQuote persis.

  plan --input <txt> --candidates <json> [--title <judul>] [--participants a,b] [--dry-run] [--json]
      Validasi kandidat (Zod), jalankan input guard, buat record meeting, lalu
      masukkan kandidat ke planCandidates() (evidence gate, clarifier, rule checker,
      validator). Hasil: output/<meetingId>-plan.json + URL approval di web app.
      --dry-run  hanya validasi + input guard, tanpa database dan tanpa menyimpan.
      --json     cetak JSON rencana ke stdout (bukan ringkasan).
      --input boleh diganti field "input" di file kandidat.

  status <meetingId> [--json]
      Status meeting, kandidat, dan pertanyaan klarifikasi yang belum dijawab.

  log <meetingId> [--json]
      Jejak audit meeting (request -> rencana -> approval -> eksekusi), urut waktu.
      Dibaca dari audit-logs/*.jsonl; bila kosong, dari tabel AuditLog.

Tidak ada perintah approve/execute: approval HANYA di web app
  ${APP_URL}/dashboard/meetings/<meetingId>

Lingkungan:
  DATABASE_URL    koneksi PostgreSQL (dibaca dari .env)
  B1_USER_EMAIL   email user pembuat rencana; default user pertama dengan role
                  ${PLAN_ROLES.join(' > ')} (role yang punya izin meeting:create)
  B1_APP_URL      basis URL web app (default http://localhost:3000)

Kode keluar: 0 ok, 1 pemakaian salah, 2 perintah ditolak, 3 database tidak tersedia,
             4 validasi kandidat gagal`;

// ============ HELPERS ============

// Flags each command accepts; anything else is refused (e.g. `plan --approve`)
const ALLOWED_FLAGS: Record<string, string[]> = {
  plan: ['input', 'candidates', 'title', 'participants', 'dry-run', 'json', 'help'],
  status: ['json', 'help'],
  log: ['json', 'help'],
  segments: ['input', 'json', 'help'],
};

function checkFlags(command: string, args: Args): void {
  const allowed = ALLOWED_FLAGS[command];
  if (!allowed) return;
  const unknown = Object.keys(args.flags).filter((f) => !allowed.includes(f));
  if (unknown.length > 0) {
    const hint = unknown.some((f) => /approv|execut|send|kirim/i.test(f)) ? ' Approval hanya di web app.' : '';
    throw new CliError(
      `Opsi tidak dikenal untuk "${command}": ${unknown.map((f) => `--${f}`).join(', ')}. ` +
        `Opsi yang tersedia: ${allowed.map((f) => `--${f}`).join(', ')}.${hint}`,
      EXIT.validation
    );
  }
}

// One user-facing label per meeting status (CLI output and plan JSON use the same words)
const STATUS_LABEL: Record<string, string> = {
  DRAFT: 'DRAF (DRAFT)',
  PROCESSING: 'SEDANG DIPROSES (PROCESSING)',
  READY: 'MENUNGGU PERSETUJUAN (READY)',
  EXECUTED: 'SUDAH DIEKSEKUSI (EXECUTED)',
  REJECTED: 'DITOLAK / GAGAL (REJECTED)',
};

function statusLabel(status: string): string {
  return STATUS_LABEL[status] ?? status;
}

/** ISO timestamp -> "2026-11-03 21:52:50 WIB" (Asia/Jakarta). */
function toWib(iso: string): string {
  const d = new Date(iso);
  if (isNaN(d.getTime())) return iso;
  return `${d.toLocaleString('sv-SE', { timeZone: 'Asia/Jakarta', hour12: false })} WIB`;
}

// Times in the app are stored in WIB (rule checker and confirmation screen use WIB)
const APP_TIMEZONE = 'WIB';

interface RecipientView {
  /** true when this is one of several contacts matching an ambiguous owner name */
  ambiguousOwnerMatch?: boolean;
  name: string;
  email: string | null;
  phone: string | null;
  timezone: string | null;
  location: string | null;
  isExternal: boolean;
}

interface ActionView {
  id: string;
  actionType: string;
  title: string;
  owner: string;
  status: string;
  dueDate: string | null;
  dueTime: string | null;
  timezone: string;
  due: string;
  isExternal: boolean;
  recipientCount: number;
  recipients: RecipientView[];
  recipientsPendingClarification: boolean;
  /** Names Chitragupta listed in `recipients` that are NOT among the stored recipients */
  requestedNotStored?: string[];
}

/** What will actually be sent, read back from the stored ActionCandidate row. */
function toActionView(
  row: {
    candidateId: string;
    actionType: string;
    title: string;
    owner: string;
    status: string;
    dueDate: string | null;
    dueTime: string | null;
    isExternal: boolean;
    recipientCount: number;
    recipients: string[];
  },
  ambiguousCandidateIds: Set<string>
): ActionView {
  const recipients: RecipientView[] = row.recipients.map((r) => {
    try {
      const info = JSON.parse(r);
      return {
        name: info.name ?? r,
        email: info.email ?? null,
        phone: info.phone ?? null,
        timezone: info.timezone ?? null,
        location: info.location ?? null,
        isExternal: info.isExternal === true,
      };
    } catch {
      return { name: r, email: null, phone: null, timezone: null, location: null, isExternal: false };
    }
  });
  if (ambiguousCandidateIds.has(row.candidateId)) {
    const matches = new Set(matchContactsByName(recipients, row.owner));
    for (const r of recipients) r.ambiguousOwnerMatch = matches.has(r);
  }
  const isExternal = row.isExternal || recipients.some((r) => r.isExternal);
  const due = row.dueDate
    ? `${row.dueDate} ${row.dueTime ? `${row.dueTime} ${APP_TIMEZONE}` : '(jam belum ditentukan)'}`
    : 'belum ditentukan';
  return {
    id: row.candidateId,
    actionType: row.actionType.toLowerCase(),
    title: row.title,
    owner: row.owner,
    status: row.status,
    dueDate: row.dueDate,
    dueTime: row.dueTime,
    timezone: APP_TIMEZONE,
    due,
    isExternal,
    recipientCount: recipients.length,
    recipients,
    recipientsPendingClarification: ambiguousCandidateIds.has(row.candidateId),
  };
}

function formatAction(a: ActionView, withStatus = false): string {
  const lines = [
    `[${a.id}] ${withStatus ? `${a.status} ` : ''}${a.actionType.toUpperCase()}${a.isExternal ? ' [EKSTERNAL]' : ''} — ${a.title}`,
    `    Pemilik tugas : ${a.owner}`,
    `    Jatuh tempo   : ${a.due}`,
  ];
  if (a.requestedNotStored && a.requestedNotStored.length > 0) {
    lines.push(
      `    PERHATIAN     : ${a.requestedNotStored.join(', ')} disebut sebagai penerima tetapi TIDAK ada di daftar ` +
        'penerima di bawah. Jangan approve; perbaiki di web app.'
    );
  }
  if (a.recipients.length === 0) {
    lines.push('    Penerima (0)  : tidak ada penerima (tidak ada pesan yang dikirim ke orang lain)');
  } else {
    lines.push(
      `    Penerima (${a.recipientCount})${' '.repeat(Math.max(0, 3 - String(a.recipientCount).length))}: ` +
        (a.recipientsPendingClarification
          ? `"${a.owner}" masih ambigu — hanya SATU yang bertanda (?) akan dipakai setelah klarifikasi:`
          : '')
    );
    lines[lines.length - 1] = lines[lines.length - 1].trimEnd();
    for (const r of a.recipients) {
      const detail = [r.email, r.phone, r.timezone && `${r.timezone}${r.location ? ` (${r.location})` : ''}`]
        .filter(Boolean)
        .join(' · ');
      lines.push(
        `      - ${r.ambiguousOwnerMatch ? '(?) ' : ''}${r.name}${detail ? ` <${detail}>` : ''}${r.isExternal ? ' [EKSTERNAL]' : ''}`
      );
    }
  }
  return lines.join('\n');
}

/** One line per question; a grouped "Budi yang mana?" names every action it applies to: [c1, c2] */
function formatQuestion(q: { candidateId: string; candidateIds?: string[]; question: string; options?: Array<{ label: string }> }): string {
  const opts = (q.options ?? []).map((o, i) => `${i + 1}) ${o.label}`);
  return `[${questionCandidateIds(q).join(', ')}] ${q.question}${opts.length ? `\n      Pilihan: ${opts.join('  ')}` : ''}`;
}

/** Is the web app up? Any HTTP answer counts; network error or timeout means no. */
async function webAppReachable(timeoutMs = 2000): Promise<boolean> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    await fetch(APP_URL, { method: 'HEAD', signal: controller.signal, redirect: 'manual' });
    return true;
  } catch {
    return false;
  } finally {
    clearTimeout(timer);
  }
}

function approveUrl(meetingId: string): string {
  return `${APP_URL}/dashboard/meetings/${meetingId}`;
}

function rel(p: string): string {
  return relative(ROOT, p).replace(/\\/g, '/') || p;
}

async function readText(path: string, what: string): Promise<string> {
  const abs = resolve(ROOT, path);
  if (!existsSync(abs)) throw new CliError(`${what} tidak ditemukan: ${path}`, EXIT.usage);
  return fs.readFile(abs, 'utf8');
}

function formatZodIssues(error: z.ZodError, raw: unknown): string {
  return error.issues
    .slice(0, 20)
    .map((i) => {
      const path = i.path.join('.');
      const idx = typeof i.path[0] === 'number' ? i.path[0] : i.path[0] === 'candidates' ? i.path[1] : undefined;
      const list = Array.isArray(raw) ? raw : (raw as any)?.candidates;
      const id = typeof idx === 'number' && Array.isArray(list) ? list[idx]?.id : undefined;
      return `  - ${path || '(root)'}${id ? ` [id=${id}]` : ''}: ${i.message}`;
    })
    .join('\n');
}

async function withTimeout<T>(p: Promise<T>, ms: number, label: string): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`${label}: timeout ${ms} ms`)), ms);
  });
  try {
    return await Promise.race([p, timeout]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

const DB_HINT =
  'Nyalakan database dulu: `docker compose up -d`, lalu `npm run db:push` dan `npm run db:seed`.';

async function connectDb() {
  if (!process.env.DATABASE_URL) {
    throw new CliError(`Database tidak tersedia: DATABASE_URL belum di-set (cek .env). ${DB_HINT}`, EXIT.db);
  }
  const { prisma } = await import('@/lib/db');
  try {
    await withTimeout(prisma.$queryRaw`SELECT 1`, DB_TIMEOUT_MS, 'koneksi database');
  } catch (err) {
    const reason = err instanceof Error ? err.message.split('\n').filter(Boolean).pop() : String(err);
    throw new CliError(`Database tidak bisa dihubungi (${reason}). ${DB_HINT}`, EXIT.db);
  }
  return prisma;
}

type Db = Awaited<ReturnType<typeof connectDb>>;

async function resolveCliUser(prisma: Db) {
  const { can } = await import('@/lib/auth/rbac');
  const email = process.env.B1_USER_EMAIL?.trim();
  if (email) {
    const user = await prisma.user.findUnique({ where: { email } });
    if (!user) throw new CliError(`B1_USER_EMAIL=${email} tidak ditemukan di tabel User.`, EXIT.usage);
    if (!can(user.role, 'meeting:create')) {
      throw new CliError(`User ${email} (role ${user.role}) tidak punya izin meeting:create.`, EXIT.refused);
    }
    return user;
  }
  for (const role of PLAN_ROLES) {
    const user = await prisma.user.findFirst({ where: { role }, orderBy: { createdAt: 'asc' } });
    if (user) return user;
  }
  throw new CliError(
    `Tidak ada user dengan role ${PLAN_ROLES.join('/')}. Jalankan \`npm run db:seed\` atau set B1_USER_EMAIL.`,
    EXIT.usage
  );
}

// ============ PREFLIGHT (no DB) ============

interface Preflight {
  text: string;
  inputPath: string;
  candidatesPath: string;
  title: string;
  participants: string[];
  candidates: ActionCandidate[];
  warnings: string[];
  guarded: import('@/lib/agent/orchestrator').GuardedText;
  segments: Array<{ id: string; text: string }>;
}

async function loadSegmenter() {
  return import('@/lib/agent/output-guard/segmenter');
}

async function preflight(args: Args): Promise<Preflight> {
  const candidatesPath = stringFlag(args, 'candidates');
  if (!candidatesPath) throw new CliError('Wajib: --candidates <file.json>. Lihat `npm run b1 -- --help`.', EXIT.usage);

  const rawJson = await readText(candidatesPath, 'File kandidat');
  let raw: unknown;
  try {
    raw = JSON.parse(rawJson.replace(/^﻿/, ''));
  } catch (err) {
    throw new CliError(`File kandidat bukan JSON valid: ${(err as Error).message}`, EXIT.validation);
  }
  // Pick the branch explicitly so Zod reports field-level issues instead of "Invalid input"
  const parsed = (Array.isArray(raw) ? CandidateFileSchema.options[0] : CandidateFileSchema.options[1]).safeParse(raw);
  if (!parsed.success) {
    throw new CliError(
      `Kandidat tidak sesuai ActionCandidateSchema (${candidatesPath}):\n${formatZodIssues(parsed.error, raw)}`,
      EXIT.validation
    );
  }
  const file: CandidateFile = parsed.data;
  const meta: { input?: string; title?: string; participants?: string[] } = Array.isArray(file) ? {} : file;
  const candidates = Array.isArray(file) ? file : file.candidates;

  const inputPath = stringFlag(args, 'input') ?? meta.input;
  if (!inputPath) throw new CliError('Wajib: --input <teks rapat.txt> (atau field "input" di file kandidat).', EXIT.usage);
  const text = (await readText(inputPath, 'File input')).replace(/^﻿/, '');
  if (text.trim().length < 10) throw new CliError('Teks rapat minimal 10 karakter.', EXIT.validation);

  const ids = candidates.map((c) => c.id);
  const dupIds = ids.filter((id, i) => ids.indexOf(id) !== i);
  if (dupIds.length > 0) {
    throw new CliError(`id kandidat harus unik; duplikat: ${[...new Set(dupIds)].join(', ')}`, EXIT.validation);
  }

  const participantsFlag = stringFlag(args, 'participants');
  const participants = participantsFlag
    ? participantsFlag.split(',').map((p) => p.trim()).filter(Boolean)
    : meta.participants ?? [];
  const title =
    stringFlag(args, 'title') ?? meta.title ?? `Rapat (Chitragupta) ${inputPath.replace(/\\/g, '/').split('/').pop()}`;

  // Layer 1: same input guard the web app uses
  const { guardInput } = await import('@/lib/agent/orchestrator');
  const guarded = guardInput(text);

  // Early feedback for Chitragupta; the binding checks run again inside planCandidates()
  const { segmentText, quoteIn } = await loadSegmenter();
  const segments = segmentText(guarded.cleanedText);
  const segMap = new Map(segments.map((s) => [s.id, s.text]));
  const warnings: string[] = [];
  for (const c of candidates) {
    if (!text.includes(c.evidenceQuote)) {
      warnings.push(`[${c.id}] evidenceQuote tidak ditemukan PERSIS (verbatim) di teks input.`);
    }
    const seg = segMap.get(c.sourceSegmentId);
    if (!seg) {
      warnings.push(`[${c.id}] sourceSegmentId "${c.sourceSegmentId}" tidak ada (teks punya seg-01..${segments.at(-1)?.id ?? '-'}).`);
    } else if (!quoteIn(c.evidenceQuote, seg)) {
      warnings.push(`[${c.id}] evidenceQuote tidak berada di ${c.sourceSegmentId}.`);
    }
    if (c.recipientCount !== c.recipients.length) {
      warnings.push(`[${c.id}] recipientCount (${c.recipientCount}) != jumlah recipients (${c.recipients.length}).`);
    }
  }
  if (guarded.injectionResult.detected) {
    // Quarantined lines: segments whose cleaned text carries [QUARANTINED], plus any
    // quarantinedSegments already reported as seg-NN (older detector uses inj-N ids).
    const quarantinedIds = new Set(segments.filter((s) => s.text.includes('[QUARANTINED]')).map((s) => s.id));
    for (const q of guarded.injectionResult.quarantinedSegments) {
      if (/^seg-\d+$/.test(q.segmentId)) quarantinedIds.add(q.segmentId);
    }
    // Raw text has the same non-empty lines, so seg ids line up; used to match quotes
    const rawSegments = new Map(segmentText(text).map((s) => [s.id, s.text]));
    const ids = [...quarantinedIds].sort();
    if (ids.length > 0) {
      warnings.push(`Baris ${ids.join(', ')} berisi perintah tersembunyi dan diabaikan.`);
    } else {
      warnings.push('Teks berisi perintah tersembunyi; bagian itu diabaikan.');
    }
    for (const c of candidates) {
      const fromId = quarantinedIds.has(c.sourceSegmentId) ? c.sourceSegmentId : undefined;
      const fromQuote = ids.find((id) => quoteIn(c.evidenceQuote, rawSegments.get(id) ?? ''));
      const segId = fromId ?? fromQuote;
      if (segId) {
        warnings.push(`[${c.id}] Baris ${segId} berisi perintah tersembunyi dan diabaikan — kandidat "${c.title}" akan dibuang.`);
      }
    }
  }

  return { text, inputPath, candidatesPath, title, participants, candidates, warnings, guarded, segments };
}

// ============ COMMANDS ============

async function cmdSegments(args: Args): Promise<void> {
  const inputPath = stringFlag(args, 'input') ?? args.positionals[0];
  if (!inputPath) throw new CliError('Wajib: --input <teks rapat.txt>.', EXIT.usage);
  const text = (await readText(inputPath, 'File input')).replace(/^﻿/, '');
  const { guardInput } = await import('@/lib/agent/orchestrator');
  const guarded = guardInput(text);
  const { segmentText, formatSegments } = await loadSegmenter();
  const segments = segmentText(guarded.cleanedText);
  if (args.flags.json) {
    console.log(JSON.stringify({ input: inputPath, segments, injectionDetected: guarded.injectionResult.detected }, null, 2));
    return;
  }
  console.log(formatSegments(segments));
  if (guarded.redactionResult.detected) {
    console.log(`\n(PII disamarkan: ${guarded.redactionResult.items.map((i) => i.type).join(', ')} — jangan kutip bagian itu)`);
  }
  if (guarded.injectionResult.detected) {
    console.log('\n(Baris bertanda [QUARANTINED] berisi instruksi tertanam — JANGAN dijadikan kandidat)');
  }
}

async function cmdPlan(args: Args): Promise<void> {
  const pre = await preflight(args);

  if (args.flags['dry-run']) {
    const summary = {
      dryRun: true,
      input: pre.inputPath,
      candidates: pre.candidatesPath,
      title: pre.title,
      participants: pre.participants,
      candidateCount: pre.candidates.length,
      segments: pre.segments.length,
      piiRedacted: pre.guarded.redactionResult.items.map((i) => i.type),
      injection: pre.guarded.injectionResult.quarantinedSegments.map((s) => s.pattern),
      preflightWarnings: pre.warnings,
    };
    if (args.flags.json) {
      console.log(JSON.stringify(summary, null, 2));
    } else {
      console.log(`Dry run OK: ${pre.candidates.length} kandidat valid terhadap ActionCandidateSchema.`);
      console.log(`Input: ${pre.inputPath} (${pre.segments.length} segmen)`);
      printList('Peringatan preflight', pre.warnings);
      console.log('\nTidak ada yang disimpan. Jalankan tanpa --dry-run untuk membuat rencana (butuh database).');
    }
    return;
  }

  const prisma = await connectDb();
  const user = await resolveCliUser(prisma);
  const { planCandidates, logInputGuard } = await import('@/lib/agent/orchestrator');
  const { logConsent, getRetentionDate } = await import('@/lib/agent/input-guard/consent-logger');
  const { logAudit, flushAuditLogs } = await import('@/lib/agent/audit-logger');

  const meeting = await prisma.meeting.create({
    data: {
      title: pre.title,
      rawText: pre.text,
      status: 'PROCESSING',
      creatorId: user.id,
      participants: pre.participants,
      retentionUntil: getRetentionDate(),
    },
  });

  try {
    await logConsent(meeting.id, {
      participantName: user.name,
      consentGiven: true,
      consentTimestamp: new Date().toISOString(),
      retentionUntil: getRetentionDate().toISOString(),
    });
    await logAudit({
      type: 'CLI_PLAN_REQUESTED',
      meetingId: meeting.id,
      userId: user.id,
      payload: {
        channel: 'cli',
        agent: 'workbuddy',
        input: pre.inputPath,
        inputSha256: createHash('sha256').update(pre.text).digest('hex'),
        candidatesFile: pre.candidatesPath,
        candidateCount: pre.candidates.length,
        candidateIds: pre.candidates.map((c) => c.id),
        preflightWarnings: pre.warnings,
      },
    });
    await logAudit({
      type: 'INPUT_RECEIVED',
      meetingId: meeting.id,
      userId: user.id,
      payload: { title: pre.title, textLength: pre.text.length, participantsCount: pre.participants.length, source: 'cli' },
    });
    await logInputGuard(meeting.id, user.id, pre.guarded);

    const result = await planCandidates({
      meetingId: meeting.id,
      title: pre.title,
      userId: user.id,
      userName: user.name,
      participants: pre.participants,
      candidates: pre.candidates,
      guarded: pre.guarded,
    });

    const unansweredRequired = result.clarifierQuestions.filter((q) => q.required !== false).length;
    // Submitted but not in the plan, rejected or open items: dropped by the injection
    // filter (quarantined line) or by schema validation inside planCandidates()
    const accountedFor = new Set([
      ...result.candidates.map((c) => c.id),
      ...(result.rejectedCandidates ?? []).map((c) => c.id),
      ...(result.openItems ?? []).map((c) => c.id),
    ]);
    const dropped = pre.candidates
      .filter((c) => !accountedFor.has(c.id))
      .map((c) => ({ id: c.id, title: c.title, evidenceQuote: c.evidenceQuote }));
    // Exactly what will be sent: read back the rows planCandidates() stored (resolved recipients)
    const [storedMeeting, storedRows] = await Promise.all([
      prisma.meeting.findUnique({ where: { id: result.meetingId }, select: { status: true } }),
      prisma.actionCandidate.findMany({ where: { meetingId: result.meetingId }, orderBy: { createdAt: 'asc' } }),
    ]);
    const ambiguous = new Set(
      result.clarifierQuestions.filter((q) => q.type === 'contact_ambiguity').flatMap((q) => questionCandidateIds(q))
    );
    const actions = storedRows.map((r) => {
      const view = toActionView(r, ambiguous);
      // The app resolves recipients from `owner`; flag names Chitragupta listed that did not make it
      const requested = pre.candidates.find((c) => c.id === view.id)?.recipients ?? [];
      view.requestedNotStored = requested.filter(
        (name) => !name.includes('@') && matchContactsByName(view.recipients, name).length === 0
      );
      return view;
    });
    const meetingStatus = storedMeeting?.status ?? 'READY';
    const appUp = await webAppReachable();

    const plan = {
      meetingId: result.meetingId,
      title: pre.title,
      status: statusLabel(meetingStatus),
      statusCode: meetingStatus,
      approveUrl: approveUrl(result.meetingId),
      webAppReachable: appUp,
      createdBy: { email: user.email, role: user.role },
      source: { input: pre.inputPath, candidates: pre.candidatesPath },
      summary: {
        submitted: pre.candidates.length,
        inPlan: actions.length,
        rejected: result.rejectedCandidates?.length ?? 0,
        openItems: result.openItems?.length ?? 0,
        droppedByInjectionGuard: dropped.length,
        external: actions.filter((x) => x.isExternal).length,
        clarifierQuestions: result.clarifierQuestions.length,
        ruleWarnings: result.ruleWarnings.length,
        evidenceIssues: result.evidenceIssues.length,
        injectionDetected: result.injectionResult?.detected ?? false,
        piiRedacted: result.redactionResult?.detected ?? false,
      },
      plan: actions.map((x) => {
        const c = result.candidates.find((rc) => rc.id === x.id);
        return { ...x, commitmentStatus: c?.commitmentStatus ?? null, evidenceQuote: c?.evidenceQuote ?? null };
      }),
      clarifierQuestions: result.clarifierQuestions,
      ruleWarnings: result.ruleWarnings,
      evidenceIssues: result.evidenceIssues,
      rejectedCandidates: result.rejectedCandidates ?? [],
      openItems: result.openItems ?? [],
      droppedByInjectionGuard: dropped,
      quarantined: result.injectionResult?.quarantinedSegments ?? [],
      preflightWarnings: pre.warnings,
      nextStep:
        unansweredRequired > 0
          ? `Buka ${approveUrl(result.meetingId)}, jawab ${unansweredRequired} pertanyaan klarifikasi, lalu approve di web app.`
          : `Buka ${approveUrl(result.meetingId)} dan approve di web app. CLI tidak bisa approve.`,
    };

    await fs.mkdir(OUTPUT_DIR, { recursive: true });
    const outFile = join(OUTPUT_DIR, `${result.meetingId}-plan.json`);
    await fs.writeFile(outFile, JSON.stringify(plan, null, 2) + '\n', 'utf8');

    if (args.flags.json) {
      console.log(JSON.stringify({ ...plan, planFile: rel(outFile) }, null, 2));
    } else {
      console.log(`Rencana dibuat — BELUM ADA AKSI YANG DIEKSEKUSI.`);
      console.log(`Meeting   : ${result.meetingId} (${pre.title})`);
      console.log(`Status    : ${plan.status}`);
      console.log(`Pembuat   : ${user.email} (${user.role})`);
      console.log(
        `Kandidat  : ${plan.summary.submitted} dikirim, ${plan.summary.inPlan} masuk rencana, ` +
          `${plan.summary.rejected} ditolak gate, ${plan.summary.openItems} open item, ` +
          `${dropped.length} dibuang (instruksi tertanam)`
      );
      printList('Rencana (menunggu persetujuan di web app)', actions.map((x) => formatAction(x)));
      printList('Pertanyaan klarifikasi (dijawab di web app)', result.clarifierQuestions.map(formatQuestion));
      printList('Peringatan aturan', result.ruleWarnings.map((w) => `[${w.candidateId}] ${w.message}`));
      printList('Masalah bukti', result.evidenceIssues.map((e) => `[${e.candidateId}] ${e.gate}: ${e.message}`));
      printList('Ditolak gate', (result.rejectedCandidates ?? []).map((r) => `[${r.id}] ${r.title}: ${r.reasons.join(', ')}`));
      printList('Dibuang karena berasal dari instruksi tertanam', dropped.map((d) => `[${d.id}] ${d.title}`));
      printList('Peringatan preflight', pre.warnings);
      console.log(`\nFile rencana: ${rel(outFile)}`);
      console.log(`Approve di web app: ${plan.approveUrl}`);
      if (!appUp) console.log('Web app belum jalan — jalankan `npm run dev` untuk approve.');
    }

    await flushAuditLogs();
  } catch (err) {
    // Leave a visible trace instead of a meeting stuck in PROCESSING
    await prisma.meeting.update({ where: { id: meeting.id }, data: { status: 'REJECTED' } }).catch(() => {});
    await flushAuditLogs();
    throw err;
  }
}

async function cmdStatus(args: Args): Promise<void> {
  const meetingId = args.positionals[0];
  if (!meetingId) throw new CliError('Pemakaian: npm run b1 -- status <meetingId>', EXIT.usage);
  const prisma = await connectDb();
  const meeting = await prisma.meeting.findUnique({
    where: { id: meetingId },
    include: { candidates: { orderBy: { createdAt: 'asc' } }, creator: { select: { email: true, role: true } } },
  });
  if (!meeting) throw new CliError(`Meeting ${meetingId} tidak ditemukan.`, EXIT.usage);

  const questions = (meeting.clarifierQuestions as any[]) || [];
  const answers = (meeting.clarifierAnswers as any[]) || [];
  const answered = new Set(answers.map((a: any) => a.questionId));
  const unanswered = questions.filter((q: any) => q.required !== false && !answered.has(q.id));

  const ambiguous = new Set(
    questions.filter((q: any) => q.type === 'contact_ambiguity' && !answered.has(q.id)).flatMap((q: any) => questionCandidateIds(q))
  );
  const status = {
    meetingId: meeting.id,
    title: meeting.title,
    status: statusLabel(meeting.status),
    statusCode: meeting.status,
    createdBy: meeting.creator,
    createdAt: meeting.createdAt,
    approved: Boolean(meeting.planHash),
    planHash: meeting.planHash,
    approveUrl: approveUrl(meeting.id),
    candidates: meeting.candidates.map((c) => toActionView(c, ambiguous)),
    clarifier: {
      total: questions.length,
      unanswered: unanswered.map((q: any) => ({ id: q.id, candidateId: q.candidateId, candidateIds: questionCandidateIds(q), question: q.question, options: q.options ?? [] })),
    },
  };

  if (args.flags.json) {
    console.log(JSON.stringify(status, null, 2));
    return;
  }
  console.log(`Meeting  : ${status.meetingId} — ${status.title}`);
  console.log(`Status   : ${status.status}${status.approved ? ` (disetujui, planHash ${status.planHash?.slice(0, 12)}…)` : ''}`);
  console.log(`Dibuat   : ${toWib(status.createdAt.toISOString())}`);
  console.log(`Pembuat  : ${status.createdBy?.email} (${status.createdBy?.role})`);
  printList('Aksi', status.candidates.map((c) => formatAction(c, true)));
  if (questions.length === 0) {
    console.log('\nKlarifikasi: tidak ada pertanyaan');
  } else if (unanswered.length === 0) {
    console.log(`\nKlarifikasi: semua ${questions.length} pertanyaan sudah dijawab`);
  } else {
    printList(`Klarifikasi belum dijawab (${unanswered.length}/${questions.length})`, status.clarifier.unanswered.map(formatQuestion));
  }
  console.log(`\nWeb app: ${status.approveUrl}`);
}

async function cmdLog(args: Args): Promise<void> {
  const meetingId = args.positionals[0];
  if (!meetingId) throw new CliError('Pemakaian: npm run b1 -- log <meetingId>', EXIT.usage);
  const { readAuditJSONL } = await import('@/lib/agent/audit-logger');

  let source = 'audit-logs/*.jsonl';
  let events = await readAuditJSONL(meetingId);
  if (events.length === 0) {
    const prisma = await connectDb();
    const rows = await prisma.auditLog.findMany({ where: { meetingId }, orderBy: { createdAt: 'asc' } });
    events = rows.map((r) => r.payload as any);
    source = 'tabel AuditLog';
  }
  if (events.length === 0) throw new CliError(`Tidak ada event audit untuk meeting ${meetingId}.`, EXIT.usage);

  if (args.flags.json) {
    console.log(JSON.stringify({ meetingId, source, events }, null, 2));
    return;
  }
  console.log(`Jejak audit ${meetingId} (${events.length} event, sumber: ${source}, waktu WIB)`);
  for (const e of events) {
    console.log(`${toWib(e.timestamp)}  ${e.type.padEnd(24)} ${summarizePayload(e.payload)}`);
  }
}

function summarizePayload(payload: Record<string, unknown> = {}): string {
  const keys = [
    'planHash', 'hash', 'candidateId', 'tool', 'reason', 'alreadyExecuted', 'executionId', 'channel', 'source',
    'candidateCount', 'actionCount', 'issues', 'total', 'valid', 'questions', 'warnings', 'blocked', 'candidates', 'patterns',
  ];
  const parts = keys
    .filter((k) => payload[k] !== undefined && payload[k] !== null)
    .map((k) => {
      const v = payload[k];
      if (Array.isArray(v)) return `${k}=${v.length}`;
      if (typeof v === 'string' && k.toLowerCase().includes('hash')) return `${k}=${v.slice(0, 12)}…`;
      return `${k}=${JSON.stringify(v)}`;
    });
  return parts.join(' ');
}

function printList(title: string, items: string[]): void {
  if (items.length === 0) return;
  console.log(`\n${title}:`);
  for (const i of items) console.log(`  - ${i}`);
}

// ============ MAIN ============

async function main(): Promise<number> {
  const args = parseArgs(process.argv.slice(2));
  const command = args.command?.toLowerCase();

  if (!command || command === 'help' || args.flags.help) {
    console.log(HELP);
    return 0;
  }

  if (REFUSED_COMMANDS.has(command)) {
    const id = args.positionals[0];
    console.error(
      `Ditolak: "${command}" tidak tersedia di CLI. Approval hanya di web app` +
        (id ? ` — buka ${approveUrl(id)}` : ` (${APP_URL}/dashboard/meetings/<meetingId>)`) +
        '. Chitragupta hanya boleh membuat rencana (plan) dan membaca status/log.'
    );
    return EXIT.refused;
  }

  checkFlags(command, args);

  switch (command) {
    case 'plan':
      await cmdPlan(args);
      return 0;
    case 'status':
      await cmdStatus(args);
      return 0;
    case 'log':
      await cmdLog(args);
      return 0;
    case 'segments':
      await cmdSegments(args);
      return 0;
    default:
      throw new CliError(`Perintah tidak dikenal: "${command}". Lihat \`npm run b1 -- --help\`.`, EXIT.usage);
  }
}

main()
  .then(async (code) => {
    await disconnect();
    process.exit(code);
  })
  .catch(async (err) => {
    if (err instanceof CliError) {
      console.error(`Error: ${err.message}`);
    } else {
      console.error('Error tak terduga:', err);
    }
    await disconnect();
    process.exit(err instanceof CliError ? err.exitCode : 1);
  });

async function disconnect(): Promise<void> {
  // Only if the DB module was loaded (help/refusal never touch Prisma)
  const g = globalThis as unknown as { prisma?: { $disconnect(): Promise<void> } };
  await g.prisma?.$disconnect().catch(() => {});
}
