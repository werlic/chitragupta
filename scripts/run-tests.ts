/**
 * B1 test runner — `npm run test:b1`
 *
 * DB-free and LLM-free: Prisma is replaced by an in-memory stub seeded from
 * data/datapack/ and the LLM provider is forced to Mock. Cases live in
 * tests/cases.json; handlers in scripts/test-support/handlers.ts.
 *
 * Output per case:  PASS|FAIL|SKIP  #id  name  (ms)  [reason]
 * Summary: pass rate, latency p50/p95, critical failures (execution without
 * approval / information leak). Exit code 1 when any case FAILs.
 *
 * Flags: --verbose (print every variant + app console output)
 *        --only=01,09,H1 (run a subset)
 *        --json=<path> (write machine-readable results)
 */
import { readFileSync, writeFileSync } from 'fs';
import { join } from 'path';
import { installEnv } from './test-support/env';

const args = process.argv.slice(2);
const VERBOSE = args.includes('--verbose');
const ONLY = (args.find((a) => a.startsWith('--only='))?.split('=')[1] || '').split(',').filter(Boolean);
const JSON_OUT = args.find((a) => a.startsWith('--json='))?.split('=')[1];
const VARIANT_TIMEOUT_MS = Number(process.env.B1_VARIANT_TIMEOUT_MS || 30_000);

interface VariantResult { name: string; ok: boolean; failures: { msg: string; critical: boolean }[]; ms: number }
interface CaseResult { id: string; name: string; status: 'PASS' | 'FAIL' | 'SKIP' | 'WARN'; ms: number; reason: string; critical: number; variants: VariantResult[] }

// Silence app logs (audit logger, LLM fallback warnings) unless --verbose
const realConsole = { log: console.log, warn: console.warn, error: console.error, info: console.info };
const appLogs: string[] = [];
function muteApp() {
  if (VERBOSE) return;
  const sink = (...a: unknown[]) => { appLogs.push(a.map(String).join(' ')); };
  console.log = sink; console.warn = sink; console.error = sink; console.info = sink;
}
function unmute() { Object.assign(console, realConsole); }
const out = (s: string) => realConsole.log(s);

function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error(`timeout ${ms} ms`)), ms);
    p.then((v) => { clearTimeout(t); resolve(v); }, (e) => { clearTimeout(t); reject(e); });
  });
}

function percentile(values: number[], p: number): number {
  if (!values.length) return 0;
  const s = [...values].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.ceil((p / 100) * s.length) - 1)];
}

async function main() {
  const casesFile = JSON.parse(readFileSync(join(process.cwd(), 'tests', 'cases.json'), 'utf8'));
  muteApp();
  const env = installEnv();
  // Handlers require app modules lazily, so they bind to the stub installed above
  const { HANDLERS } = require('./test-support/handlers');
  let providerName = '?';
  try { providerName = (await require('@/lib/llm').getLLMProviderAsync()).name; } catch (e) { providerName = `error: ${(e as Error).message}`; }
  unmute();

  out(`B1 test suite — ${casesFile.cases.length} kasus — LLM provider: ${providerName} — DB: Prisma stub (data/datapack)`);
  out('');

  const metrics: Record<string, { ok: number; total: number }> = {};
  const results: CaseResult[] = [];

  for (const c of casesFile.cases) {
    if (ONLY.length && !ONLY.includes(c.id)) continue;
    const label = `#${c.id}`.padEnd(4);
    if (c.skip || c.handler === 'skip') {
      results.push({ id: c.id, name: c.name, status: 'SKIP', ms: 0, reason: c.skip || 'skip', critical: 0, variants: [] });
      out(`SKIP  ${label}  ${c.name}  (0 ms)  [${c.skip || 'skip'}]`);
      continue;
    }
    const handler = HANDLERS[c.handler];
    const caseStart = Date.now();
    const variants: VariantResult[] = [];
    for (const v of c.variants || [{ name: 'default' }]) {
      const failures: { msg: string; critical: boolean }[] = [];
      const ctx = {
        fail: (msg: string, critical = false) => { failures.push({ msg, critical }); },
        check: (cond: unknown, msg: string, critical = false) => { if (!cond) failures.push({ msg, critical }); return !!cond; },
        metric: (name: string, ok: boolean) => { const m = (metrics[name] ||= { ok: 0, total: 0 }); m.total++; if (ok) m.ok++; },
      };
      const t0 = Date.now();
      muteApp();
      try {
        env.reset();
        if (!handler) throw new Error(`handler '${c.handler}' tidak ada`);
        await withTimeout(handler(v, ctx), VARIANT_TIMEOUT_MS);
      } catch (e) {
        failures.push({ msg: `error: ${(e as Error)?.message ?? e}`.split('\n')[0], critical: false });
      } finally {
        unmute();
      }
      variants.push({ name: v.name, ok: failures.length === 0, failures, ms: Date.now() - t0 });
    }
    const ms = Date.now() - caseStart;
    const failed = variants.filter((x) => !x.ok);
    const critical = variants.reduce((n, x) => n + (x.failures.some((f) => f.critical) ? 1 : 0), 0);
    const reason = failed.length
      ? `${failed.length}/${variants.length} variasi gagal: ` + failed.map((x) => `${x.name} → ${x.failures.map((f) => (f.critical ? 'CRITICAL ' : '') + f.msg).join('; ')}`).join(' || ')
      : `${variants.length}/${variants.length} variasi`;
    // nonBlocking cases (e.g. R6) report WARN: visible, but excluded from pass rate and exit code
    const status = failed.length ? (c.nonBlocking ? 'WARN' : 'FAIL') : 'PASS';
    results.push({ id: c.id, name: c.name, status, ms, reason, critical, variants });
    out(`${status}  ${label}  ${c.name}  (${ms} ms)  [${failed.length ? `${failed.length}/${variants.length} variasi gagal` : reason}]`);
    for (const x of variants) {
      if (!x.ok || VERBOSE) {
        out(`        ${x.ok ? 'ok  ' : 'FAIL'}  ${x.name}  (${x.ms} ms)${x.ok ? '' : '  → ' + x.failures.map((f) => (f.critical ? 'CRITICAL ' : '') + f.msg).join('; ')}`);
      }
    }
  }

  const ran = results.filter((r) => r.status !== 'SKIP' && r.status !== 'WARN');
  const warn = results.filter((r) => r.status === 'WARN').length;
  const pass = ran.filter((r) => r.status === 'PASS').length;
  const fail = ran.length - pass;
  const skip = results.length - ran.length - warn;
  const lat = ran.map((r) => r.ms);
  const vlat = ran.flatMap((r) => r.variants.map((v) => v.ms));
  const totalVariants = ran.reduce((n, r) => n + r.variants.length, 0);
  const passVariants = ran.reduce((n, r) => n + r.variants.filter((v) => v.ok).length, 0);
  const critical = ran.reduce((n, r) => n + r.critical, 0);

  out('');
  out('================ RINGKASAN ================');
  out(`Kasus     : ${results.length} (PASS ${pass}, FAIL ${fail}, SKIP ${skip}, WARN ${warn} non-blocking)`);
  out(`Pass rate : ${ran.length ? ((pass / ran.length) * 100).toFixed(1) : '0.0'}% kasus (${pass}/${ran.length}), ${totalVariants ? ((passVariants / totalVariants) * 100).toFixed(1) : '0.0'}% variasi (${passVariants}/${totalVariants})`);
  out(`Latency   : per kasus p50 ${percentile(lat, 50)} ms, p95 ${percentile(lat, 95)} ms | per variasi p50 ${percentile(vlat, 50)} ms, p95 ${percentile(vlat, 95)} ms`);
  out(`Critical  : ${critical} critical failure (eksekusi tanpa approval / bocor info; target 0)`);
  for (const [k, m] of Object.entries(metrics)) out(`Metrik    : ${k} ${m.ok}/${m.total} (${((m.ok / m.total) * 100).toFixed(0)}%)`);
  if (fail) out(`\nGAGAL: ${ran.filter((r) => r.status === 'FAIL').map((r) => '#' + r.id).join(', ')}`);

  if (JSON_OUT) {
    writeFileSync(JSON_OUT, JSON.stringify({ when: new Date().toISOString(), provider: providerName, results, metrics, summary: { pass, fail, skip, critical, p50: percentile(lat, 50), p95: percentile(lat, 95), passVariants, totalVariants } }, null, 2));
  }
  process.exit(fail ? 1 : 0);
}

main().catch((e) => {
  unmute();
  console.error('Runner crash:', e);
  process.exit(2);
});
