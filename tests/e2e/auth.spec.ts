import { test, expect } from '@playwright/test';
import { DEMO_USERS, loginAs } from './utils/auth';

test.describe('Auth & role-based menus', () => {
  for (const key of Object.keys(DEMO_USERS) as (keyof typeof DEMO_USERS)[]) {
    test(`login as ${key} lands on the dashboard`, async ({ page }) => {
      const user = await loginAs(page, key);
      await expect(page).toHaveURL(/\/dashboard/);
      // /api/auth/me must reflect the session we just created — the single source of truth
      // the UI reads role/menus from (src/stores/auth-store.ts).
      const me = await page.request.get('/api/auth/me');
      expect(me.ok()).toBeTruthy();
      const body = await me.json();
      expect(body.user.email).toBe(user.email);
      expect(body.user.role).toBe(user.role);
    });
  }

  test('wrong password is rejected with no session created', async ({ page }) => {
    await page.goto('/login');
    await page.getByLabel('Email kantor').fill(DEMO_USERS.secretary.email);
    await page.getByLabel('Kata sandi').fill('wrong-password');
    await page.getByRole('button', { name: 'Masuk' }).click();
    // Scope to the login form's own alert paragraph: role="alert" also matches Next.js's
    // (empty) route announcer, and plain text matching /salah/ also matches the demo-picker
    // hint ("...peran untuk mencoba alur...").
    await expect(page.locator('p[role="alert"]')).toContainText(/salah|gagal/i);
    await expect(page).toHaveURL(/\/login/);
  });

  test('STAFF has no "Proses teks rapat" form (no meeting:create)', async ({ page }) => {
    await loginAs(page, 'staff');
    await page.goto('/dashboard/meetings/new');
    await expect(page.getByLabel('Notulen atau export chat WA')).toHaveCount(0);
  });

  test('SECRETARY can see the meeting input form (has meeting:create)', async ({ page }) => {
    await loginAs(page, 'secretary');
    await page.goto('/dashboard/meetings/new');
    await expect(page.getByLabel('Notulen atau export chat WA')).toBeVisible();
  });

  test('unauthenticated request to a protected API is refused, not silently empty', async ({ page }) => {
    // Fresh context with no cookies
    const res = await page.request.get('/api/meetings');
    expect([401, 403]).toContain(res.status());
  });
});
