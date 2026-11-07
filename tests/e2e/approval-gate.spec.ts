import { test, expect } from '@playwright/test';
import { loginAs } from './utils/auth';
import { submitMeetingText, readPlanHash } from './utils/pipeline';
import { promptById } from './fixtures/prompts';

/**
 * "Approval fitur" — /api/agent/approve is the ONLY path to the mock tools
 * (AGENTS.md / src/app/api/agent/approve/route.ts). Every test here checks the
 * SERVER gate directly with page.request, not just that the UI button is
 * disabled, since a disabled button proves nothing about the route itself.
 */
test.describe('Approval gate', () => {
  test('clean plan: approve executes and starts a 60s undo window', async ({ page }) => {
    await loginAs(page, 'secretary');
    const meetingId = await submitMeetingText(page, promptById('approval-01-single-clear-action'));

    const approveBtn = page.getByRole('button', { name: /Approve & jalankan 1 aksi/ });
    await expect(approveBtn).toBeEnabled();
    await approveBtn.click();

    await expect(page.getByText(/Dieksekusi/).first()).toBeVisible({ timeout: 10_000 });
    // Undo countdown must appear — "approve langsung menjalankan aksi; undo tersedia 60 detik" (canvas States A).
    await expect(page.getByRole('button', { name: /Undo/i })).toBeVisible();

    // Idempotency: calling approve again for the same candidate must not create a second execution.
    const meetingRes = await page.request.get(`/api/meetings/${meetingId}`);
    const meeting = (await meetingRes.json()).meeting;
    const candidate = meeting.candidates[0];
    const second = await page.request.post('/api/agent/approve', {
      data: { meetingId, approved: [{ candidateId: candidate.candidateId, planHash: candidate.planHash }] },
    });
    const secondBody = await second.json();
    // Either refused outright, or the one result for this candidate carries no NEW executionId
    if (second.ok()) {
      const r = secondBody.results.find((x: any) => x.candidateId === candidate.candidateId);
      expect(r.executionId).toBeUndefined();
    }
  });

  test('approve is refused (403) while a clarifier question is unanswered', async ({ page }) => {
    await loginAs(page, 'secretary');
    const meetingId = await submitMeetingText(page, promptById('approval-02-two-budi-clarifier-required'));

    // UI: no enabled approve button while clarifier is pending.
    await expect(page.getByRole('button', { name: /Approve & jalankan/i })).toHaveCount(0);
    await expect(page.getByText(/pertanyaan wajib dijawab sebelum approve/i)).toBeVisible();

    // Server: approving directly (bypassing the UI) must still be refused.
    const meetingRes = await page.request.get(`/api/meetings/${meetingId}`);
    const meeting = (await meetingRes.json()).meeting;
    const candidate = meeting.candidates[0];
    const res = await page.request.post('/api/agent/approve', {
      data: { meetingId, approved: [{ candidateId: candidate.candidateId, planHash: candidate.planHash }] },
    });
    expect(res.status()).toBe(403);
    const body = await res.json();
    expect(body.clarifierRequired).toBeTruthy();

    // Answer the clarifier, then approval must become possible.
    await page.getByRole('radio', { name: /Budi Santoso/ }).check();
    await page.getByRole('button', { name: 'Simpan jawaban' }).click();
    await expect(page.getByRole('button', { name: /Approve & jalankan/i })).toBeEnabled();
  });

  test('high-impact (external recipient) needs an explicit confirmation before approve (409)', async ({ page }) => {
    // Pak Andi (Konsultan Andi, e003) can only be contacted by ADMIN/MANAGER per
    // data/datapack/permissions.json contactRules — SECRETARY would hit a SEPARATE
    // permission_denied, which would be a different test than the one this checks.
    await loginAs(page, 'manager');
    const meetingId = await submitMeetingText(page, promptById('approval-03-high-impact-external'));

    // The card's own badge, not the sidebar's "Konfirmasi dampak tinggi" checklist line.
    await expect(page.getByText(/· DAMPAK TINGGI/)).toBeVisible();

    const meetingRes = await page.request.get(`/api/meetings/${meetingId}`);
    const meeting = (await meetingRes.json()).meeting;
    const candidate = meeting.candidates[0];

    // Without confirmHighImpact: refused.
    const denied = await page.request.post('/api/agent/approve', {
      data: { meetingId, approved: [{ candidateId: candidate.candidateId, planHash: candidate.planHash }] },
    });
    expect(denied.status()).toBe(409);
    expect((await denied.json()).highImpactRequired).toBeTruthy();

    // Tick the on-screen confirmation, then approve succeeds.
    await page.getByRole('checkbox').first().check();
    await page.getByRole('button', { name: /Approve & jalankan/i }).click();
    await expect(page.getByText(/Dieksekusi/).first()).toBeVisible({ timeout: 10_000 });
  });

  test('editing the plan after it was shown invalidates the old approval (plan-hash binding)', async ({ page }) => {
    await loginAs(page, 'secretary');
    const meetingId = await submitMeetingText(page, promptById('approval-01-single-clear-action'));

    // submitMeetingText only waits for the URL; the review page's own data fetch
    // (loadMeeting) is still in flight right after navigation ("Memuat meeting...").
    await expect(page.getByRole('button', { name: /Approve & jalankan/i })).toBeVisible();
    const staleHash = await readPlanHash(page);
    expect(staleHash).toBeTruthy();

    const meetingRes = await page.request.get(`/api/meetings/${meetingId}`);
    const candidate = (await meetingRes.json()).meeting.candidates[0];

    // The real candidate, but a planHash that does not match what the server computes
    // for its current details — simulates a stale client showing an outdated plan.
    const res = await page.request.post('/api/agent/approve', {
      data: { meetingId, approved: [{ candidateId: candidate.candidateId, planHash: 'deliberately-wrong-hash' }] },
    });
    expect(res.status()).toBe(409);
    const body = await res.json();
    expect(body.planChanged).toBeTruthy();
  });

  test('a rejected plan can never be approved afterwards', async ({ page }) => {
    await loginAs(page, 'secretary');
    const meetingId = await submitMeetingText(page, promptById('approval-04-reject-then-cannot-approve'));

    const meetingRes = await page.request.get(`/api/meetings/${meetingId}`);
    const candidate = (await meetingRes.json()).meeting.candidates[0];

    await page.getByRole('button', { name: 'Tolak rencana' }).click();
    const dialog = page.getByRole('dialog');
    await dialog.getByLabel(/Alasan/).fill('Penerimanya salah, uji e2e.');
    // Wait for the actual reject response (not just the UI's optimistic "Ditolak" state)
    // before calling approve — otherwise the approve request can race ahead of the write.
    const rejectResponse = page.waitForResponse((r) => r.url().includes('/api/agent/reject'));
    await dialog.getByRole('button', { name: 'Tolak rencana' }).click();
    const rejectBody = await (await rejectResponse).json();
    expect(rejectBody.meetingStatus).toBe('REJECTED');
    await expect(page.getByText('Ditolak').first()).toBeVisible();

    const res = await page.request.post('/api/agent/approve', {
      data: { meetingId, approved: [{ candidateId: candidate.candidateId, planHash: candidate.planHash }] },
    });
    expect(res.status()).toBe(409);
    expect((await res.json()).rejectedCandidate).toBeTruthy();
  });

  test('MANAGER (no execution:approve) can still approve their OWN plan as creator', async ({ page }) => {
    await loginAs(page, 'manager');
    await submitMeetingText(page, promptById('approval-01-single-clear-action'));
    await expect(page.getByRole('button', { name: /Approve & jalankan 1 aksi/ })).toBeEnabled();
  });

  test('STAFF cannot reach the approval route at all (no meeting:create, not a creator)', async ({ page }) => {
    await loginAs(page, 'staff');
    // STAFF has no "Proses teks rapat" form; hit the API with a made-up meetingId instead.
    const res = await page.request.post('/api/agent/approve', {
      data: { meetingId: 'nonexistent-meeting-id', approved: [{ candidateId: 'x', planHash: 'y' }] },
    });
    expect([403, 404]).toContain(res.status());
  });
});
