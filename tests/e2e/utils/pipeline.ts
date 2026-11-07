import type { Page } from '@playwright/test';
import type { TestPrompt } from '../fixtures/prompts';

/**
 * Submits a meeting text through the real "Proses teks rapat" form
 * (dashboard/meetings/new) and waits for the redirect to the review screen.
 * Returns the created meetingId. Throws if the parser rejects the text
 * (PARSER_FAILED) so a test fails loudly instead of hanging.
 *
 * Deliberately never fills the "Judul" field from `prompt.title` — that field
 * is the human-readable test/doc description (e.g. "Dua Budi — approve harus
 * ditolak..."), not a meeting title, and its wording (e.g. "dampak tinggi",
 * "klarifikasi") would otherwise leak onto the page and collide with the
 * real UI text assertions are checking for. Pass `meetingTitle` explicitly
 * if a test genuinely needs a custom title.
 */
export async function submitMeetingText(
  page: Page,
  prompt: Pick<TestPrompt, 'text' | 'participants'>,
  opts: { meetingTitle?: string } = {}
) {
  await page.goto('/dashboard/meetings/new');
  if (opts.meetingTitle) {
    await page.getByLabel('Judul').fill(opts.meetingTitle);
  }
  if (prompt.participants) {
    // { exact: true } matters: the consent checkbox's label also starts with "Peserta...".
    await page.getByLabel('Peserta', { exact: true }).fill(prompt.participants);
  }
  await page.getByLabel('Notulen atau export chat WA').fill(prompt.text);
  await page.getByLabel(/Peserta setuju teks ini diproses/).check();
  await page.getByRole('button', { name: /Susun rencana|Mencoba lagi|Coba lagi/ }).click();

  // Prisma cuids start with "c" and run ~25 chars — excluding that shape (not just "[a-z0-9]+",
  // which also matches the literal "new" of the page we're already on) matters: without it,
  // waitForURL resolves on the CURRENT /dashboard/meetings/new URL instantly, before the
  // client-side router.push to the real review page ever fires, and "new" gets returned as
  // if it were the meetingId.
  await page.waitForURL(/\/dashboard\/meetings\/c[a-z0-9]{20,}$/i, { timeout: 20_000 });
  const match = /\/dashboard\/meetings\/(c[a-z0-9]{20,})$/i.exec(page.url());
  if (!match) throw new Error(`Did not land on a meeting review page: ${page.url()}`);
  return match[1];
}

/** Current plan hash shown in the approval panel ("Plan hash (berubah bila rencana diedit)"). */
export async function readPlanHash(page: Page): Promise<string | null> {
  const code = page.locator('code[title]').first();
  if (!(await code.isVisible().catch(() => false))) return null;
  return code.getAttribute('title');
}
