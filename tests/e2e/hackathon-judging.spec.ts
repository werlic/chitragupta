import { test, expect } from '@playwright/test';
import { loginAs } from './utils/auth';
import { submitMeetingText } from './utils/pipeline';
import { promptById } from './fixtures/prompts';

/**
 * One scenario per Handbook judging dimension that is best proven live rather
 * than read from code (see docs/evaluation/self-score.md for the full
 * dimension-by-dimension review). Impact/Feasibility/Innovation are already
 * covered by the suite as a whole and are not duplicated here.
 */
test.describe('Hackathon judging-dimension walkthroughs', () => {
  test.beforeEach(async ({ page }) => {
    await loginAs(page, 'secretary');
  });

  test(promptById('judging-human-centered-ask-only-when-ambiguous').title, async ({ page }) => {
    await submitMeetingText(page, promptById('judging-human-centered-ask-only-when-ambiguous'));

    // Asks about the ambiguous name...
    await expect(page.getByText(/Budi yang mana/i)).toBeVisible();
    // ...but says nothing about the unambiguous one anywhere in the same plan.
    await expect(page.getByText(/Sari.{0,20}mana\?/i)).toHaveCount(0);
  });

  test(promptById('judging-responsible-ai-no-execution-before-approval').title, async ({ page }) => {
    const meetingId = await submitMeetingText(page, promptById('judging-responsible-ai-no-execution-before-approval'));

    // Saying "langsung...sekarang" in the text changes nothing: it is still a PENDING plan.
    await expect(page.getByText(/Dieksekusi/)).toHaveCount(0);
    const meetingRes = await page.request.get(`/api/meetings/${meetingId}`);
    const meeting = (await meetingRes.json()).meeting;
    expect(meeting.status).not.toBe('EXECUTED');
    expect(meeting.candidates.every((c: any) => c.status === 'PENDING')).toBeTruthy();
  });

  test(promptById('judging-responsible-ai-permission-denied').title, async ({ page }) => {
    const meetingId = await submitMeetingText(page, promptById('judging-responsible-ai-permission-denied'));

    const meetingRes = await page.request.get(`/api/meetings/${meetingId}`);
    const meeting = (await meetingRes.json()).meeting;
    // Answer any clarifier (contact ambiguity) if present, then try to approve all.
    if (meeting.clarifierQuestions?.length) {
      for (const q of meeting.clarifierQuestions) {
        const value = q.options?.[0]?.value;
        if (value) {
          await page.request.post('/api/agent/clarify', {
            data: { meetingId, answers: [{ questionId: q.id, value }] },
          });
        }
      }
    }
    const fresh = await (await page.request.get(`/api/meetings/${meetingId}`)).json();
    const pending = fresh.meeting.candidates.filter((c: any) => c.status === 'PENDING');
    const res = await page.request.post('/api/agent/approve', {
      data: {
        meetingId,
        approved: pending.map((c: any) => ({ candidateId: c.candidateId, planHash: c.planHash })),
        confirmHighImpact: true,
      },
    });
    // Permission denial surfaces as a per-action result, not a thrown error or a silent skip.
    const body = await res.json();
    const denials = (body.results ?? []).filter((r: any) => r.reason === 'permission_denied');
    expect(denials.length).toBeGreaterThan(0);
  });

  test(promptById('judging-technical-execution-pii-redaction').title, async ({ page }) => {
    await submitMeetingText(page, promptById('judging-technical-execution-pii-redaction'));

    // The redaction markers must be visible; the raw NIK/phone must never render anywhere.
    await expect(page.getByText(/\[NIK-REDACTED\]|\[PHONE-REDACTED\]/).first()).toBeVisible();
    await expect(page.getByText('3201012505990001')).toHaveCount(0);
    await expect(page.getByText('081234567890')).toHaveCount(0);
  });

  test(promptById('judging-overall-quality-friday-prayer-buffer').title, async ({ page }) => {
    await submitMeetingText(page, promptById('judging-overall-quality-friday-prayer-buffer'));

    // Rule warning proposes a time after the Friday-prayer block (11:30-13:00 + buffer).
    await expect(page.getByText(/salat Jumat|13:30|13\.30/i).first()).toBeVisible();
  });
});
