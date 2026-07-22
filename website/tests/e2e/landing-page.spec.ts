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
  await expect(page).toHaveTitle(/HammaDev.*Native Local Continuity/);
  await expect(page.getByRole('main')).toBeVisible();
  await expect(
    page.getByRole('heading', {
      level: 1,
      name: /Your agents remember where the work stopped/i,
    }),
  ).toBeVisible();

  await expect(page.getByText('Codex · Claude · Grok', { exact: true })).toBeVisible();
  await expect(page.getByText('hamma save', { exact: true }).first()).toBeVisible();
  await expect(page.getByText('hamma hooks install', { exact: true }).first()).toBeVisible();
  await expect(page.getByText('hamma codex', { exact: true }).first()).toBeVisible();
  await expect(page.getByText(VERSION_LABEL, { exact: true }).first()).toBeVisible();
  await expect(page.getByText('SessionStart context ready', { exact: true })).toBeVisible();
});

test('explains the native continuity workflow and safety boundaries', async ({ page }) => {
  await expect(page.getByRole('heading', { name: 'How it works' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Enable memory explicitly' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Install trusted hooks' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Give Codex a real exit boundary' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Switch or finish normally' })).toBeVisible();

  await expect(page.getByText('Native lifecycle', { exact: true })).toBeVisible();
  await expect(page.getByText('Exact Codex exit', { exact: true })).toBeVisible();
  await expect(page.getByText('Crash recovery', { exact: true })).toBeVisible();

  await expect(page.getByText('No backend', { exact: true })).toBeVisible();
  await expect(page.getByText('No cloud sync', { exact: true })).toBeVisible();
  await expect(page.getByText('Trust-controlled', { exact: true })).toBeVisible();
  await expect(page.getByText(/Only transcript bytes persisted to disk are recoverable/i)).toBeVisible();
  await expect(page.getByText(/Redaction is best-effort, not a privacy guarantee/i)).toBeVisible();
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
  await expect(page.getByRole('link', { name: /npm install/i })).toBeFocused();

  await page.locator('#install').scrollIntoViewIfNeeded();
  await page.getByRole('button', { name: 'Copy install command' }).focus();
  await expect(page.getByRole('button', { name: 'Copy install command' })).toBeFocused();
});
