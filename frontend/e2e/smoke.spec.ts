import { test, expect } from '@playwright/test';

// Smoke test: verifies all 24 screens render without crashing and have basic content.
// Run after: npx playwright install chromium

const PUBLIC_ROUTES = [
  { path: '/',                        label: 'Landing' },
  { path: '/discover',                label: 'Discover' },
  { path: '/election/e1',             label: 'Election Preview (active)' },
  { path: '/election/e4/results',     label: 'Election Results (closed)' },
  { path: '/how-it-works',            label: 'How It Works' },
  { path: '/verify-receipt',          label: 'Verify Receipt' },
];

const VOTER_ROUTES = [
  { path: '/voter/onboarding',                        label: 'Onboarding' },
  { path: '/voter/re-verify',                         label: 'Re-verification' },
  { path: '/voter/elections',                         label: 'Voter Elections' },
  { path: '/voter/election/e1',                       label: 'Election Detail (active)' },
  { path: '/voter/election/e2',                       label: 'Election Detail (enrolling)' },
  { path: '/voter/election/e1/zk-proof',              label: 'ZK Proof Generation' },
  { path: '/voter/election/e4/confirmation',          label: 'Vote Confirmation' },
  { path: '/voter/election/e1/change-vote',           label: 'Change Vote' },
  { path: '/voter/history',                           label: 'Voter History' },
];

const ORGANIZER_ROUTES = [
  { path: '/organizer/auth',          label: 'Organizer Auth' },
  { path: '/organizer/dashboard',     label: 'Organizer Dashboard' },
  { path: '/organizer/elections/new', label: 'Create Election' },
  { path: '/organizer/election/e1',   label: 'Election Management' },
  { path: '/organizer/gas',           label: 'Gas Management' },
  { path: '/organizer/members',       label: 'Member List' },
  { path: '/organizer/profile',       label: 'Organizer Profile' },
];

const ALL_ROUTES = [...PUBLIC_ROUTES, ...VOTER_ROUTES, ...ORGANIZER_ROUTES];

/**
 * No backend: every API call answers as a server with no session would. The
 * smoke test is about the screens rendering, and a real issuer would make it
 * depend on World ID and a chain it has no business needing.
 */
test.beforeEach(async ({ page }) => {
  await page.route('**/api/**', route =>
    route.fulfill({ status: 401, contentType: 'application/json', body: '{"authenticated":false}' }),
  );
});

/** Console errors that are the stub above doing its job, not the app failing. */
const expected = (message: string) =>
  message.includes('Warning:') ||
  message.includes('React DevTools') ||
  message.includes('status of 401');

for (const { path, label } of ALL_ROUTES) {
  test(`[smoke] ${label} — ${path}`, async ({ page }) => {
    // Listening before navigating, or the errors of the first paint are missed.
    const errors: string[] = [];
    page.on('console', msg => {
      if (msg.type() === 'error') errors.push(msg.text());
    });
    page.on('pageerror', error => errors.push(error.message));
    await page.goto(path);
    // Wait for app to hydrate
    await page.waitForLoadState('networkidle');
    // Page should not show an unhandled crash (React error boundary)
    await expect(page.locator('body')).not.toContainText('Something went wrong');
    // No uncaught JS errors that would block render
    expect(errors.filter(e => !expected(e))).toHaveLength(0);
  });
}

test('[smoke] 404 page', async ({ page }) => {
  await page.goto('/this-route-does-not-exist');
  await page.waitForLoadState('networkidle');
  await expect(page.locator('body')).toContainText('not found');
});

test('[smoke] Discover — lists the demo elections', async ({ page }) => {
  await page.goto('/discover');
  await page.waitForLoadState('networkidle');
  // The demo catalogue renders a heading per election card.
  await expect(page.locator('h2, h3').first()).toBeVisible();
});

test('[smoke] Organizer Create Election — not offered without a session', async ({ page }) => {
  await page.goto('/organizer/elections/new');
  await page.waitForLoadState('networkidle');
  // Without an organizer session the wizard is not offered: the visitor is
  // sent back out (to the landing page today) rather than shown a broken form.
  await expect(page).not.toHaveURL(/\/organizer\/elections\/new$/);
  await expect(page.locator('body')).not.toContainText('Something went wrong');
});
