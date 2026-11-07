import { test, expect } from '@playwright/test';
import { loginAs } from './utils/auth';
import { submitMeetingText } from './utils/pipeline';
import { promptById } from './fixtures/prompts';

/**
 * "Test instruksi" — the agent must extract exactly what the text asks, nothing
 * invented and nothing silently dropped, and never guess an ambiguous name.
 * AGENTS.md §4: "Jangan mengarang" / "Nama ambigu jangan ditebak".
 */
test.describe('Instruction-following', () => {
  test.beforeEach(async ({ page }) => {
    await loginAs(page, 'secretary');
  });

  test(promptById('instr-01-handbook-example').title, async ({ page }) => {
    const prompt = promptById('instr-01-handbook-example');
    await submitMeetingText(page, prompt);

    // Two actions: email to "Pak Budi" and a calendar follow-up — never more, never fewer.
    const cards = page.locator('section[aria-label^="Aksi"]');
    await expect(cards).toHaveCount(2);
    await expect(page.getByText('EMAIL', { exact: true })).toBeVisible();
    await expect(page.getByText('KALENDER', { exact: true })).toBeVisible();

    // The card's own title/heading is written exactly as the text said it ("Pak Budi") —
    // never silently resolved to one specific Budi. (Both full names DO appear further down,
    // in the card's pending-recipients list and the clarifier's own options — that's the
    // clarifier correctly showing what it's disambiguating between, not a resolved guess.)
    await expect(cards.first().getByRole('heading')).toContainText('Pak Budi');

    // The clarifier must ask "which Budi" with both contacts as options.
    await expect(page.getByText(/Budi yang mana/i)).toBeVisible();
    await expect(page.getByRole('radio', { name: /Budi Santoso/ })).toBeVisible();
    await expect(page.getByRole('radio', { name: /Budi Hartono/ })).toBeVisible();

    // The Finance invite is a hedge ("mungkin sebaiknya") — open item, never a 3rd action.
    // (Two headings legitimately say "Open item": the sidebar's own section, and the
    // collapsed notulen's internal summary — matched here by their differing exact text.)
    await expect(page.getByRole('heading', { name: 'Open item (tidak dieksekusi)', exact: true })).toBeVisible();
    await expect(page.getByText(/Finance/i).first()).toBeVisible();
  });

  test(promptById('instr-02-no-questions-when-clear').title, async ({ page }) => {
    await submitMeetingText(page, promptById('instr-02-no-questions-when-clear'));

    // Unique names + explicit date/time/zone everywhere -> zero clarifier questions.
    await expect(page.getByText(/pertanyaan wajib dijawab/i)).toHaveCount(0);
    const cards = page.locator('section[aria-label^="Aksi"]');
    await expect(cards).toHaveCount(2);
    // Scoped to the cards (not the whole page): the collapsed "Notulen rapat" section also
    // contains these names verbatim, in its raw transcript, but stays hidden until expanded.
    await expect(cards.getByText('Joko Susilo').first()).toBeVisible();
    await expect(cards.getByText('Anton Gunawan').first()).toBeVisible();

    // Approve must be immediately available (no blocking reason) for the creator.
    const approveBtn = page.getByRole('button', { name: /Approve & jalankan/i });
    await expect(approveBtn).toBeEnabled();
  });

  test(promptById('instr-03-suggestion-stays-suggestion').title, async ({ page }) => {
    await submitMeetingText(page, promptById('instr-03-suggestion-stays-suggestion'));

    // Only the one clear task is an action; the hedged lines are never one of the cards.
    const cards = page.locator('section[aria-label^="Aksi"]');
    await expect(cards).toHaveCount(1);
    await expect(cards.first()).toContainText('Dewi Lestari');
    await expect(cards.first()).not.toContainText(/mungkin|sebaiknya|bagaimana kalau/i);
  });

  test(promptById('instr-04-ambiguous-timezone').title, async ({ page }) => {
    await submitMeetingText(page, promptById('instr-04-ambiguous-timezone'));

    // Cross-timezone participants + a bare time -> must ask which zone it refers to,
    // never silently assume WIB.
    await expect(page.getByText(/zona/i).first()).toBeVisible();
  });
});
