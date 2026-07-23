import { expect, test } from '@playwright/test';
import { readFileSync } from 'node:fs';

const INSTALL_COMMAND = 'npm install -g hammadev@beta';
const ROOT_PACKAGE = JSON.parse(
  readFileSync(new URL('../../../package.json', import.meta.url), 'utf8'),
) as { version: string };
const VERSION_LABEL = `v${ROOT_PACKAGE.version}`;

test.beforeEach(async ({ page }) => {
  await page.goto('/');
});

test('presents the current product identity and supported agents accurately', async ({ page }) => {
  await expect(page).toHaveTitle(/HammaDev.*Project Memory/);
  await expect(page.getByRole('main')).toBeVisible();
  await expect(
    page.getByRole('heading', {
      level: 1,
      name: /Your agents remember where the work stopped/i,
    }),
  ).toBeVisible();

  await expect(page.getByText('Codex · Claude · Grok', { exact: true }).first()).toBeVisible();
  await expect(page.getByText('hamma', { exact: true }).first()).toBeVisible();
  await expect(page.getByText(VERSION_LABEL, { exact: true }).first()).toBeVisible();
  await expect(page.getByText('SessionStart context ready', { exact: true })).toBeVisible();
});

test('explains the native continuity workflow and safety boundaries', async ({ page }) => {
  await expect(page.getByRole('heading', { name: 'How it works' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Run one command' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Choose your agent' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Continue normally' })).toBeVisible();

  await expect(page.getByText('Native lifecycle', { exact: true })).toBeVisible();
  await expect(page.getByText('Exact Codex exit', { exact: true })).toBeVisible();
  await expect(page.getByText('Crash recovery', { exact: true })).toBeVisible();

  await expect(page.getByText('No backend', { exact: true })).toBeVisible();
  await expect(page.getByText('No cloud sync', { exact: true })).toBeVisible();
  await expect(page.getByText('Trust-controlled', { exact: true })).toBeVisible();
  await expect(page.getByText(/Only transcript bytes persisted to disk are recoverable/i)).toBeVisible();
  await expect(page.getByText(/Redaction is best-effort, not a privacy guarantee/i)).toBeVisible();
});

test('explains the OpenAI Day contribution without implying runtime model lock-in', async ({ page }) => {
  const openAiDay = page.locator('#openai-day');

  await expect(
    openAiDay.getByRole('heading', { name: /Hardened with GPT-5.6.*Local at runtime/i }),
  ).toBeVisible();
  await expect(openAiDay.getByText('No model lock-in', { exact: true })).toBeVisible();
  await expect(openAiDay.getByText(/entered Build Week as a working cross-agent handoff prototype/i)).toBeVisible();
  await expect(openAiDay.getByText(/needs no HammaDev account, API key, or cloud backend/i)).toBeVisible();
});

test('publishes canonical social metadata for the deployed domain', async ({ page }) => {
  await expect(page.locator('link[rel="canonical"]')).toHaveAttribute(
    'href',
    'https://hammadev.nematov.com/',
  );
  await expect(page.locator('meta[property="og:url"]')).toHaveAttribute(
    'content',
    'https://hammadev.nematov.com/',
  );
  await expect(page.locator('meta[property="og:image"]')).toHaveAttribute(
    'content',
    'https://hammadev.nematov.com/og-image.png',
  );
  await expect(page.locator('meta[name="twitter:card"]')).toHaveAttribute(
    'content',
    'summary_large_image',
  );
});

test('serves the social card and crawler files from the built site', async ({ page }) => {
  const socialCard = await page.request.get('/og-image.png');
  expect(socialCard.ok()).toBe(true);
  expect(socialCard.headers()['content-type']).toBe('image/png');
  const socialCardBytes = await socialCard.body();
  expect(socialCardBytes.readUInt32BE(16)).toBe(1200);
  expect(socialCardBytes.readUInt32BE(20)).toBe(630);

  const robots = await page.request.get('/robots.txt');
  expect(robots.ok()).toBe(true);
  await expect(robots.text()).resolves.toContain(
    'Sitemap: https://hammadev.nematov.com/sitemap.xml',
  );

  const sitemap = await page.request.get('/sitemap.xml');
  expect(sitemap.ok()).toBe(true);
  await expect(sitemap.text()).resolves.toContain(
    '<loc>https://hammadev.nematov.com/</loc>',
  );
});

test('copies the documented beta install command', async ({ page, context }) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);

  const install = page.locator('#install');
  await expect(install.getByText(INSTALL_COMMAND, { exact: true })).toBeVisible();

  const copyButton = install.getByRole('button', { name: 'Copy install command' });
  await copyButton.click();

  await expect(copyButton).toContainText('Copied');
  await expect
    .poll(() => page.evaluate(() => navigator.clipboard.readText()))
    .toBe(INSTALL_COMMAND);
});

test('uses safe external links and valid destinations', async ({ page }) => {
  const externalLinks = page.locator('a[target="_blank"]');
  expect(await externalLinks.count()).toBeGreaterThan(0);

  for (let index = 0; index < (await externalLinks.count()); index += 1) {
    const link = externalLinks.nth(index);
    const href = await link.getAttribute('href');
    const rel = await link.getAttribute('rel');

    expect(href).toMatch(/^https:\/\/(github\.com\/hamma-labs\/hammadev|www\.npmjs\.com\/package\/hammadev)/);
    expect(rel).toContain('noopener');
    expect(rel).toContain('noreferrer');
  }

  await expect(page.locator('a[href="#"]')).toHaveCount(0);
});

for (const viewport of [
  { width: 320, height: 568 },
  { width: 375, height: 812 },
  { width: 768, height: 1024 },
  { width: 1440, height: 900 },
]) {
  test(`does not overflow at ${viewport.width}x${viewport.height}`, async ({ page }) => {
    await page.setViewportSize(viewport);
    const hasOverflow = await page.evaluate(
      () => document.documentElement.scrollWidth > window.innerWidth,
    );
    expect(hasOverflow).toBe(false);
  });
}

test('has a single page heading and keyboard-reachable primary actions', async ({ page }) => {
  await expect(page.locator('h1')).toHaveCount(1);

  await page.keyboard.press('Tab');
  await expect(page.getByRole('link', { name: 'OpenAI Day' })).toBeFocused();
  await page.keyboard.press('Tab');
  await expect(page.getByRole('link', { name: 'HammaDev on GitHub' })).toBeFocused();
  await page.keyboard.press('Tab');
  await expect(page.getByRole('link', { name: /npm install/i })).toBeFocused();

  await page.locator('#install').scrollIntoViewIfNeeded();
  await page.getByRole('button', { name: 'Copy install command' }).focus();
  await expect(page.getByRole('button', { name: 'Copy install command' })).toBeFocused();
});
