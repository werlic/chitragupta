/**
 * Test environment for the B1 suite: DB-free (Prisma stub on globalThis),
 * LLM forced to Mock, fake auth for Next.js route handlers, and spies that
 * record every LLM prompt (for leak checks) and every tool execution.
 *
 * Everything from src/ is loaded with require() AFTER installEnv(), so
 * src/lib/db.ts picks up the stub instead of a real PrismaClient.
 */
import Module from 'module';
import { createPrismaStub, Table, type PrismaStub } from './prisma-stub';

export interface FakeUser {
  userId: string;
  email: string;
  name: string;
  role: 'ADMIN' | 'DIRECTOR' | 'MANAGER' | 'SECRETARY' | 'STAFF';
}

export const USERS: Record<string, FakeUser> = {
  secretary: { userId: 'u-secretary', email: 'sari@company.id', name: 'Sari Wijaya', role: 'SECRETARY' },
  manager: { userId: 'u-manager', email: 'budi.santoso@company.id', name: 'Budi Santoso', role: 'MANAGER' },
  director: { userId: 'u-director', email: 'hendra@company.id', name: 'Pak Hendra', role: 'DIRECTOR' },
  staff: { userId: 'u-staff', email: 'budi.hartono@company.id', name: 'Budi Hartono', role: 'STAFF' },
};

export interface Env {
  db: PrismaStub;
  llmPrompts: string[];
  setUser: (u: FakeUser | null) => void;
  reset: () => void;
  req: (id: string) => any;
}

let env: Env | null = null;

export function installEnv(): Env {
  if (env) return env;

  process.env.LLM_PROVIDER = 'mock';
  // Point any real provider at a closed port so a health check fails fast (fallback to Mock)
  process.env.OPENAI_BASE_URL = process.env.OPENAI_BASE_URL_TEST || 'http://127.0.0.1:9/v1';
  process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-secret-b1';

  const base = createPrismaStub();
  const dynamicTables = new Map<string, Table>();
  const db = new Proxy(base, {
    get(target, prop, receiver) {
      if (typeof prop === 'string' && !(prop in target) && !prop.startsWith('$') && !prop.startsWith('_') && prop !== 'then') {
        if (!dynamicTables.has(prop)) dynamicTables.set(prop, new Table(prop));
        return dynamicTables.get(prop);
      }
      return Reflect.get(target, prop, receiver);
    },
  }) as PrismaStub;
  (globalThis as any).prisma = db;

  // Fake '@/lib/auth' so route handlers can be called outside a Next request
  let currentUser: FakeUser | null = USERS.secretary;
  const authPath = require.resolve('@/lib/auth');
  const fake = new Module(authPath);
  fake.filename = authPath;
  fake.loaded = true;
  fake.exports = {
    getCurrentUser: async () => currentUser,
    requireAuth: async () => {
      if (!currentUser) throw new Error('UNAUTHORIZED');
      return currentUser;
    },
    getCurrentUserWithProfile: async () => currentUser && { id: currentUser.userId, ...currentUser },
  };
  require.cache[authPath] = fake;

  const llmPrompts: string[] = [];
  // Spy on the Mock provider: every prompt that would reach an LLM is recorded
  try {
    const mock = require('@/lib/llm/mock');
    const proto = mock.MockLLMProvider.prototype;
    const origChat = proto.chat;
    proto.chat = async function (messages: Array<{ content: string }>) {
      for (const m of messages) llmPrompts.push(String(m.content ?? ''));
      return origChat.call(this, messages);
    };
    if (proto.parseJSON) {
      const origParse = proto.parseJSON;
      proto.parseJSON = async function (prompt: string, schema: unknown, systemPrompt?: string) {
        llmPrompts.push(String(prompt ?? ''));
        if (systemPrompt) llmPrompts.push(String(systemPrompt));
        return origParse.call(this, prompt, schema, systemPrompt);
      };
    }
    if (proto.chatWithTools) {
      const origTools = proto.chatWithTools;
      proto.chatWithTools = async function (messages: Array<{ content: string }>, ...rest: unknown[]) {
        for (const m of messages) llmPrompts.push(String(m.content ?? ''));
        return origTools.call(this, messages, ...rest);
      };
    }
  } catch (e) {
    console.warn('[test-env] could not spy on MockLLMProvider:', (e as Error).message);
  }

  env = {
    db,
    llmPrompts,
    setUser: (u) => { currentUser = u; },
    reset: () => {
      base.__reset();
      for (const t of dynamicTables.values()) t.rows = [];
      llmPrompts.length = 0;
      currentUser = USERS.secretary;
    },
    req: (id: string) => require(id),
  };
  return env;
}

/** Fake NextRequest: route handlers only call request.json(). */
export function jsonRequest(body: unknown): any {
  return {
    json: async () => body,
    headers: new Headers({ 'content-type': 'application/json' }),
    nextUrl: new URL('http://localhost/api/test'),
    url: 'http://localhost/api/test',
    cookies: { get: () => undefined },
  };
}

export async function callRoute(routeModule: string, body: unknown): Promise<{ status: number; body: any }> {
  const mod = require(routeModule);
  const res = await mod.POST(jsonRequest(body));
  let parsed: any = null;
  try { parsed = await res.json(); } catch { parsed = null; }
  return { status: res.status, body: parsed };
}
