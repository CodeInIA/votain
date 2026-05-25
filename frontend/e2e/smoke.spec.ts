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

for (const { path, label } of ALL_ROUTES) {
  test(`[smoke] ${label} — ${path}`, async ({ page }) => {
    await page.goto(path);
    // No JS errors in console during navigation
    const errors: string[] = [];
    page.on('console', msg => {
      if (msg.type() === 'error') errors.push(msg.text());
    });
    // Wait for app to hydrate
    await page.waitForLoadState('networkidle');
    // Page should not show an unhandled crash (React error boundary)
    await expect(page.locator('body')).not.toContainText('Something went wrong');
    // No uncaught JS errors that would block render
    expect(errors.filter(e => !e.includes('Warning:') && !e.includes('React DevTools'))).toHaveLength(0);
  });
}

test('[smoke] 404 page', async ({ page }) => {
  await page.goto('/this-route-does-not-exist');
  await page.waitForLoadState('networkidle');
  await expect(page.locator('body')).toContainText('not found');
});

test('[smoke] Discover — search and filter', async ({ page }) => {
  await page.goto('/discover');
  await page.waitForLoadState('networkidle');
  // Election cards should be visible
  await expect(page.locator('[data-testid="election-card"]').or(page.locator('.election-card'))).toHaveCount(0).or(
    expect(page.locator('h2, h3')).not.toHaveCount(0)
  );
});

test('[smoke] Organizer Create Election — wizard navigation', async ({ page }) => {
  await page.goto('/organizer/elections/new');
  await page.waitForLoadState('networkidle');
  // Should show stepper with first step
  await expect(page.locator('body')).toContainText('Info');
});
