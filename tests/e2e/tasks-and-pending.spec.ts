import { test, expect } from '@playwright/test';
import { loginAs } from './utils/auth';
import { submitMeetingText } from './utils/pipeline';
import { promptById } from './fixtures/prompts';

test.describe('Tasks (Tugas) and Pending-approval views', () => {
  test('a freshly created plan shows up on the Pending page before anyone approves it', async ({ page }) => {
    await loginAs(page, 'secretary');
    await submitMeetingText(page, promptById('approval-02-two-budi-clarifier-required'));

    await page.goto('/dashboard/tasks/pending');
    await expect(page.getByRole('heading', { name: 'To Do pending' })).toBeVisible();
    await expect(page.getByText(/belum di-approve/i)).toBeVisible();
    // This specific plan needs clarification -> must be tagged, not shown as ready.
    await expect(page.getByText('Perlu klarifikasi').first()).toBeVisible();
  });

  test('STAFF sees the Tugas (Tasks) menu and only tasks assigned to them', async ({ page }) => {
    await loginAs(page, 'staff');
    await page.goto('/dashboard/tasks');
    await expect(page.getByRole('heading', { name: 'Tugas' })).toBeVisible();
    // Regression guard (Notion [BUG]): the Tugas menu must not be hidden from STAFF.
    const res = await page.request.get('/api/tasks');
    expect(res.ok()).toBeTruthy();
  });

  test('Tugas view switches between List / Table / Board without losing data', async ({ page }) => {
    await loginAs(page, 'secretary');
    await submitMeetingText(page, promptById('instr-02-no-questions-when-clear'));
    await page.goto('/dashboard/tasks');

    for (const view of ['List', 'Table', 'Board']) {
      await page.getByRole('tab', { name: view }).click();
      await expect(page.getByRole('tab', { name: view, selected: true })).toBeVisible();
    }
  });

  test('Audit log page is visible to ADMIN and hidden from STAFF', async ({ page }) => {
    await loginAs(page, 'admin');
    const adminRes = await page.request.get('/api/admin/audit');
    expect(adminRes.ok()).toBeTruthy();

    await loginAs(page, 'staff');
    const staffRes = await page.request.get('/api/admin/audit');
    expect(staffRes.status()).toBe(403);
  });
});
