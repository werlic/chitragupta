import type { Page } from '@playwright/test';

/** Seed accounts (prisma/seed.ts) — same five demo users the login page offers. */
export const DEMO_USERS = {
  admin: { email: 'admin@company.id', name: 'System Admin', role: 'ADMIN' },
  director: { email: 'hendra@company.id', name: 'Pak Hendra', role: 'DIRECTOR' },
  manager: { email: 'budi.santoso@company.id', name: 'Budi Santoso', role: 'MANAGER' },
  secretary: { email: 'sari.wijaya@company.id', name: 'Sari Wijaya', role: 'SECRETARY' },
  staff: { email: 'budi.hartono@company.id', name: 'Budi Hartono', role: 'STAFF' },
} as const;

export const DEMO_PASSWORD = 'password123';

export type DemoUserKey = keyof typeof DEMO_USERS;

/**
 * Logs in via the plain email/password form (deterministic — no dialog timing).
 * Clears any existing session first: /login redirects an already-authenticated
 * visitor straight to /dashboard (src/middleware.ts), so switching roles within
 * one test needs the old cookie gone before the form will even render.
 */
export async function loginAs(page: Page, who: DemoUserKey) {
  const user = DEMO_USERS[who];
  await page.context().clearCookies();
  await page.goto('/login');
  await page.getByLabel('Email kantor').fill(user.email);
  await page.getByLabel('Kata sandi').fill(DEMO_PASSWORD);
  await page.getByRole('button', { name: 'Masuk' }).click();
  await page.waitForURL('**/dashboard**');
  return user;
}

export async function logout(page: Page) {
  await page.request.post('/api/auth/logout');
  await page.goto('/login');
}
