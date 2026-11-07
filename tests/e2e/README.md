# E2E test suite (Playwright)

Browser/HTTP tests against the **real running app** (Next.js + a real Postgres,
real cookies/JWT, real RBAC and route handlers) — not the mocked pipeline
harness `npm run test:b1` uses (in-process, Prisma stub). The two suites are
complementary:

| | `npm run test:b1` / `test:b1:db` | `npm run test:e2e` (this folder) |
|---|---|---|
| What it drives | `runPipeline()` / `runPipelineWithCandidates()` directly | the browser, hitting real HTTP routes |
| DB | Prisma stub (no DB) or a real Postgres | a real, seeded Postgres |
| Auth/RBAC | not exercised | exercised (real login, cookies, 401/403) |
| UI | not exercised | exercised (clarifier form, approve button, banners) |
| Good at | fast, exhaustive gate/rule logic, many variations | "does the whole thing actually work for a human clicking buttons" |

## One-time setup

```bash
cp .env.example .env        # then edit DATABASE_URL if you don't use the default port
docker compose up -d        # Postgres
npm run db:push
npm run db:seed
npx playwright install chromium
```

Force the Mock LLM provider for deterministic runs (no Ollama/OpenAI needed):
add `LLM_PROVIDER="mock"` to `.env`.

## Running

Start the app yourself first (this suite does not manage the server, since it
needs a real seeded Postgres the Playwright `webServer` option can't sequence):

```bash
npm run dev                 # or: PORT=3100 npx tsx server.ts
E2E_BASE_URL=http://localhost:3100 npm run test:e2e
```

`npm run test:e2e:ui` opens Playwright's UI mode (step through, inspect
locators). `npm run test:e2e:report` opens the last HTML report.

## Layout

- `fixtures/prompts.ts` — the "test case prompts": meeting texts organized by
  category (`instruction`, `approval`, `injection`, `judging`). The same
  prompts are documented for manual/demo use in
  [`../e2e_test_prompts.md`](../e2e_test_prompts.md) at the repo's `tests/`
  root — read that file for what each prompt proves and how to check it by
  hand without Playwright.
- `utils/auth.ts` — `loginAs(page, 'secretary' | 'manager' | ...)` against the
  five seeded demo accounts (`prisma/seed.ts`), `logout`.
- `utils/pipeline.ts` — `submitMeetingText()` drives the real "Proses teks
  rapat" form and returns the created `meetingId`.
- `auth.spec.ts` — login/logout, role-gated pages, unauthenticated API calls.
- `instruction-following.spec.ts` — the agent extracts exactly what the text
  asks (AGENTS.md §4: no invented recipients/dates, no guessed ambiguous
  names, suggestions stay suggestions).
- `approval-gate.spec.ts` — the human-approval gate itself: clarifier
  required, plan-hash binding, high-impact confirmation, reject, idempotency,
  role-based approve eligibility. Every test calls the API directly
  (`page.request`) in addition to checking the UI, since a disabled button
  proves nothing about the server route.
- `prompt-injection.spec.ts` — embedded instructions (EN + ID), mixed with
  legitimate requests, and an all-injection transcript.
- `hackathon-judging.spec.ts` — one live scenario per Handbook judging
  dimension that's better shown running than read from code.
- `tasks-and-pending.spec.ts` — the Tugas (list/table/board) and To-Do
  pending screens, and that Audit stays admin/director-only.

## Isolation note

This suite mutates real data (creates meetings, approves/rejects plans). Run
it against a disposable database — not whatever Postgres your own dev/demo
session is using — and don't run it in parallel with yourself (the Playwright
config already forces `workers: 1`, `fullyParallel: false`).
