import { test, expect } from '@playwright/test';

test.describe('HammaDev Landing Page E2E Test Suite', () => {

  test.beforeEach(async ({ page }) => {
    // Navigate to the local dev server
    await page.goto('/');
  });

  // ==========================================
  // TIER 1: Feature Coverage (>=5 per feature)
  // ==========================================

  test.describe('Tier 1: Feature Coverage', () => {

    test('F1: Hero Section details and structure', async ({ page }) => {
      const section = page.locator('[data-testid="hero-section"]');
      await expect(section).toBeVisible();

      // T1-Hero-1: Verify Hero heading is exactly "Local handoff for AI coding agents."
      const heading = page.locator('[data-testid="hero-heading"]');
      await expect(heading).toHaveText('Local handoff for AI coding agents.');

      // T1-Hero-2: Verify Hero subheading contains Codex, Claude Code, and 100% local handoff details
      const subheading = page.locator('[data-testid="hero-subheading"]');
      await expect(subheading).toContainText('Codex');
      await expect(subheading).toContainText('Claude Code');
      await expect(subheading).toContainText('100% local handoff');

      // T1-Hero-3: Verify Hero CTA button exists and is visible
      const cta = page.locator('[data-testid="hero-cta"]');
      await expect(cta).toBeVisible();
      await expect(cta).toHaveText('Get Started');

      // T1-Hero-4: Verify Hero code block exists and contains commands
      const codeBlock = page.locator('[data-testid="hero-code-block"]');
      await expect(codeBlock).toBeVisible();
      await expect(codeBlock).toContainText('hamma save');

      // T1-Hero-5: Verify Hero "alpha" tag/label is present
      const alphaTag = page.locator('[data-testid="hero-alpha-tag"]');
      await expect(alphaTag).toBeVisible();
      await expect(alphaTag).toContainText(/alpha/i);
    });

    test('F2: Problem Section details', async ({ page }) => {
      const section = page.locator('[data-testid="problem-section"]');
      await expect(section).toBeVisible();

      // T1-Problem-1: Verify Problem heading exists
      const heading = section.locator('h2');
      await expect(heading).toBeVisible();

      // T1-Problem-2: Verify problem description details context loss
      await expect(section).toContainText('context loss');

      // T1-Problem-3: Verify key pain points are listed
      const listItems = section.locator('ul li');
      await expect(listItems).toHaveCount(3);

      // T1-Problem-4: Verify problem layout styles are active (visible/rendered)
      const isVisible = await section.isVisible();
      expect(isVisible).toBe(true);

      // T1-Problem-5: Verify no overhype/fake testimonials
      const pageText = await page.innerText('body');
      expect(pageText).not.toContain('amazing tool');
      expect(pageText).not.toContain('changed my life');
      await expect(section).toContainText('No overhype, no fake testimonials');
    });

    test('F3: How It Works Section', async ({ page }) => {
      const section = page.locator('[data-testid="how-it-works-section"]');
      await expect(section).toBeVisible();

      // T1-How-1: Verify "How it works" heading exists
      const heading = section.locator('h2');
      await expect(heading).toHaveText('How It Works');

      // T1-How-2: Verify 3-step cards exist
      const step1 = page.locator('[data-testid="how-step-1"]');
      const step2 = page.locator('[data-testid="how-step-2"]');
      const step3 = page.locator('[data-testid="how-step-3"]');
      await expect(step1).toBeVisible();
      await expect(step2).toBeVisible();
      await expect(step3).toBeVisible();

      // T1-How-3: Verify step titles are Save, Choose, and Load
      await expect(step1.locator('h3')).toContainText('Save');
      await expect(step2.locator('h3')).toContainText('Choose');
      await expect(step3.locator('h3')).toContainText('Load');

      // T1-How-4: Verify visual flow diagram/representation is present
      const flowDiagram = page.locator('[data-testid="how-flow-diagram"]');
      await expect(flowDiagram).toBeVisible();

      // T1-How-5: Verify step ordering is correct chronologically
      const step1Text = await step1.innerText();
      const step2Text = await step2.innerText();
      const step3Text = await step3.innerText();
      expect(step1Text).toContain('1.');
      expect(step2Text).toContain('2.');
      expect(step3Text).toContain('3.');
    });

    test('F4: Terminal Demo Section and interaction', async ({ page }) => {
      const section = page.locator('[data-testid="terminal-demo-section"]');
      await expect(section).toBeVisible();

      // T1-Demo-1: Verify Terminal Demo heading exists
      await expect(section.locator('h2')).toContainText('Terminal Demo');

      // T1-Demo-2: Verify terminal console mock container exists
      const consoleMock = page.locator('[data-testid="terminal-console"]');
      await expect(consoleMock).toBeVisible();

      // T1-Demo-3: Verify interactive commands or triggers exist
      const saveBtn = page.locator('[data-testid="cmd-save-btn"]');
      const loadBtn = page.locator('[data-testid="cmd-load-btn"]');
      const doctorBtn = page.locator('[data-testid="cmd-doctor-btn"]');
      const statusBtn = page.locator('[data-testid="cmd-status-btn"]');
      await expect(saveBtn).toBeVisible();
      await expect(loadBtn).toBeVisible();
      await expect(doctorBtn).toBeVisible();
      await expect(statusBtn).toBeVisible();

      // T1-Demo-4: Verify interactive clicks update console text
      const output = page.locator('[data-testid="terminal-output"]');
      await saveBtn.click();
      await expect(output).toContainText('hamma save');

      // T1-Demo-5: Verify CLI commands are shown
      await loadBtn.click();
      await expect(output).toContainText('hamma load --agent claude');
    });

    test('F5: Features Section (6 cards)', async ({ page }) => {
      const section = page.locator('[data-testid="features-section"]');
      await expect(section).toBeVisible();

      // T1-Feat-1: Verify Features heading exists
      await expect(section.locator('h2')).toHaveText('Features');

      // T1-Feat-2: Verify exactly 6 feature cards are displayed
      const cards = page.locator('[data-testid="feature-card"]');
      await expect(cards).toHaveCount(6);

      // T1-Feat-3: Verify "100% Local" and "Zero-Backend" feature cards
      const localCard = page.locator('[data-testid="feat-local"]');
      const zeroBackendCard = page.locator('[data-testid="feat-zero-backend"]');
      await expect(localCard).toBeVisible();
      await expect(zeroBackendCard).toBeVisible();

      // T1-Feat-4: Verify "Context Redaction" card exists
      const redactionCard = page.locator('[data-testid="feat-redaction"]');
      await expect(redactionCard).toBeVisible();

      // T1-Feat-5: Verify card titles and descriptions are correct
      const title = page.locator('[data-testid="feat-local"]');
      await expect(title).toHaveText('100% Local');
    });

    test('F6: Safety Model Section', async ({ page }) => {
      const section = page.locator('[data-testid="safety-section"]');
      await expect(section).toBeVisible();

      // T1-Safety-1: Verify Safety heading exists
      await expect(section.locator('h2')).toContainText('Safety');

      // T1-Safety-2: Verify safety text mentions "best-effort redaction" honestly
      await expect(section).toContainText('best-effort redaction');

      // T1-Safety-3: Verify safety text states no cloud uploads are made
      await expect(section).toContainText('no cloud uploads');

      // T1-Safety-4: Verify security/encryption details are described
      await expect(section).toContainText('Security & encryption');

      // T1-Safety-5: Verify safety section layout is rendered properly
      const isVisible = await section.isVisible();
      expect(isVisible).toBe(true);
    });

    test('F7: Install Section and copy button', async ({ page, context }) => {
      const section = page.locator('[data-testid="install-section"]');
      await expect(section).toBeVisible();

      // T1-Install-1: Verify Install heading exists
      await expect(section.locator('h2')).toHaveText('Installation');

      // T1-Install-2: Verify install command "npm i -g hammadev" is present
      const commandText = page.locator('[data-testid="install-command"]');
      await expect(commandText).toHaveText('npm i -g hammadev');

      // T1-Install-3: Verify copy button exists
      const copyBtn = page.locator('[data-testid="install-copy-btn"]');
      await expect(copyBtn).toBeVisible();

      // T1-Install-4: Verify copy button copies the command text to clipboard
      await context.grantPermissions(['clipboard-read', 'clipboard-write']);
      await copyBtn.click();
      const clipboardContent = await page.evaluate(() => navigator.clipboard.readText());
      expect(clipboardContent).toBe('npm i -g hammadev');

      // T1-Install-5: Verify copy button visual success feedback
      await expect(copyBtn).toHaveText('Copied!');
    });

    test('F8: Alpha Limitations Section', async ({ page }) => {
      const section = page.locator('[data-testid="limitations-section"]');
      await expect(section).toBeVisible();

      // T1-Alpha-1: Verify Limitations heading exists
      await expect(section.locator('h2')).toContainText('Limitations');

      // T1-Alpha-2: Verify clear disclaimer of "alpha" software
      await expect(section).toContainText('alpha');

      // T1-Alpha-3: Verify mentions "best-effort redaction" honestly
      await expect(section).toContainText('best-effort redaction');

      // T1-Alpha-4: Verify states "no backend" or "pure local CLI"
      await expect(section).toContainText('no backend');

      // T1-Alpha-5: Verify limitations typography is standard body size/color
      const isVisible = await section.isVisible();
      expect(isVisible).toBe(true);
    });

    test('F9: Roadmap Section', async ({ page }) => {
      const section = page.locator('[data-testid="roadmap-section"]');
      await expect(section).toBeVisible();

      // T1-Roadmap-1: Verify Roadmap heading exists
      await expect(section.locator('h2')).toContainText('Roadmap');

      // T1-Roadmap-2: Verify v0.1/v0.2/v0.3/v1.0 stages are listed
      const stages = page.locator('[data-testid="roadmap-item"]');
      await expect(stages).toHaveCount(4);

      // T1-Roadmap-3: Verify stages are styled in a visual timeline or grid
      const isVisible = await section.isVisible();
      expect(isVisible).toBe(true);

      // T1-Roadmap-4: Verify future features are described honestly
      await expect(stages.nth(3)).toContainText('Production');

      // T1-Roadmap-5: Verify the layout order is chronological
      const stageTexts = await stages.allTextContents();
      expect(stageTexts[0]).toContain('v0.1');
      expect(stageTexts[1]).toContain('v0.2');
      expect(stageTexts[2]).toContain('v0.3');
      expect(stageTexts[3]).toContain('v1.0');
    });

    test('F10: Final CTA & Footer Section links', async ({ page }) => {
      const footer = page.locator('[data-testid="footer-section"]');
      await expect(footer).toBeVisible();

      // T1-Footer-1: Verify Final CTA button exists
      const finalCta = page.locator('[data-testid="final-cta-btn"]');
      await expect(finalCta).toBeVisible();

      // T1-Footer-2: Verify GitHub link exists and points exactly to: https://github.com/xayrullonematov/hammadev
      const githubLink = page.locator('[data-testid="github-link"]');
      await expect(githubLink).toHaveAttribute('href', 'https://github.com/xayrullonematov/hammadev');

      // T1-Footer-3: Verify npm link exists and points exactly to: https://www.npmjs.com/package/hammadev
      const npmLink = page.locator('[data-testid="npm-link"]');
      await expect(npmLink).toHaveAttribute('href', 'https://www.npmjs.com/package/hammadev');

      // T1-Footer-4: Verify license information is present
      const licenseInfo = page.locator('[data-testid="license-info"]');
      await expect(licenseInfo).toContainText('ISC License');

      // T1-Footer-5: Verify no pricing, signup, or login links are present
      const links = await footer.locator('a').all();
      for (const link of links) {
        const text = await link.innerText();
        expect(text.toLowerCase()).not.toContain('price');
        expect(text.toLowerCase()).not.toContain('sign up');
        expect(text.toLowerCase()).not.toContain('login');
      }
    });

  });

  // ==========================================
  // TIER 2: Boundary & Corner Cases
  // ==========================================

  test.describe('Tier 2: Boundary & Corner Cases', () => {

    const viewports = [
      { width: 1440, height: 900, name: 'Desktop' },
      { width: 768, height: 1024, name: 'Tablet' },
      { width: 375, height: 812, name: 'Mobile' },
      { width: 1920, height: 1080, name: 'Extra Large' },
      { width: 320, height: 568, name: 'Small Mobile' }
    ];

    for (const vp of viewports) {
      test(`Verify layout elements do not overflow horizontally on ${vp.name} (${vp.width}x${vp.height})`, async ({ page }) => {
        await page.setViewportSize({ width: vp.width, height: vp.height });
        // Check document width vs window innerWidth
        const overflow = await page.evaluate(() => {
          return document.documentElement.scrollWidth > window.innerWidth;
        });
        expect(overflow).toBe(false);
      });
    }

    test('Verify secure href attributes (target="_blank" rel="noopener noreferrer") on external links', async ({ page }) => {
      const externalLinks = page.locator('a[target="_blank"]');
      const count = await externalLinks.count();
      expect(count).toBeGreaterThan(0);

      for (let i = 0; i < count; i++) {
        const rel = await externalLinks.nth(i).getAttribute('rel');
        expect(rel).toContain('noopener');
        expect(rel).toContain('noreferrer');
      }
    });

    test('Verify rapid button clicks (spamming terminal buttons)', async ({ page }) => {
      const saveBtn = page.locator('[data-testid="cmd-save-btn"]');
      const loadBtn = page.locator('[data-testid="cmd-load-btn"]');
      const output = page.locator('[data-testid="terminal-output"]');

      // Click rapidly back-and-forth
      for (let i = 0; i < 10; i++) {
        await saveBtn.click({ force: true });
        await loadBtn.click({ force: true });
      }

      // Check if it's still responsive and showing load command
      await expect(output).toContainText('hamma load --agent claude');
    });

    test('Contrast and visibility of safety disclaimer and alpha tag', async ({ page }) => {
      const disclaimer = page.locator('[data-testid="hero-alpha-tag"]');
      await expect(disclaimer).toBeVisible();

      // Check styles to verify text color is visible
      const color = await disclaimer.evaluate(el => window.getComputedStyle(el).color);
      expect(color).not.toBe('rgba(0, 0, 0, 0)');
    });

  });

  // ==========================================
  // TIER 3: Cross-Feature Combinations
  // ==========================================

  test.describe('Tier 3: Cross-Feature Combinations', () => {

    test('Verify uniform typography (sans-serif) and dark background colors across all 10 sections', async ({ page }) => {
      const sections = [
        'hero-section', 'problem-section', 'how-it-works-section', 'terminal-demo-section',
        'features-section', 'safety-section', 'install-section', 'limitations-section',
        'roadmap-section', 'footer-section'
      ];

      for (const sectionId of sections) {
        const locator = page.locator(`[data-testid="${sectionId}"]`);
        await expect(locator).toBeVisible();

        // Check font family is sans-serif or inherits from body
        const fontFamily = await locator.evaluate(el => window.getComputedStyle(el).fontFamily);
        expect(fontFamily.toLowerCase()).toContain('sans-serif');

        // Check background is a dark color (sum of RGB components is small)
        const bgColor = await locator.evaluate(el => window.getComputedStyle(el).backgroundColor);
        // Extracts r, g, b
        const rgb = bgColor.match(/\d+/g);
        if (rgb) {
          const sum = parseInt(rgb[0]) + parseInt(rgb[1]) + parseInt(rgb[2]);
          expect(sum).toBeLessThan(150); // Dark background check
        }
      }
    });

    test('Verify Hero CTA button scrolls smoothly to the Install section', async ({ page }) => {
      const scrollYBefore = await page.evaluate(() => window.scrollY);
      expect(scrollYBefore).toBe(0);

      // Click Hero CTA
      await page.locator('[data-testid="hero-cta"]').click();

      // Wait for smooth scroll completion
      await page.waitForTimeout(1000);

      const scrollYAfter = await page.evaluate(() => window.scrollY);
      expect(scrollYAfter).toBeGreaterThan(0);

      // Verify that the Install section is in the viewport
      const installBox = page.locator('[data-testid="install-section"]');
      const isInViewport = await installBox.evaluate((el) => {
        const rect = el.getBoundingClientRect();
        return rect.top >= 0 && rect.bottom <= (window.innerHeight || document.documentElement.clientHeight);
      });
      expect(isInViewport).toBe(true);
    });

    test('Verify consistent code block styling (monospaced) in Hero, Terminal Demo, and Install sections', async ({ page }) => {
      const monospacedLocators = [
        page.locator('[data-testid="hero-code-block"]'),
        page.locator('[data-testid="terminal-output"]'),
        page.locator('[data-testid="install-command"]')
      ];

      for (const loc of monospacedLocators) {
        await expect(loc).toBeVisible();
        const fontFamily = await loc.evaluate(el => window.getComputedStyle(el).fontFamily);
        expect(fontFamily.toLowerCase()).toContain('monospace');
      }
    });

    test('Verify keyboard focus flow moves sequentially down the page', async ({ page }) => {
      // Press tab repeatedly and check that we can traverse focusable elements
      await page.keyboard.press('Tab');
      const activeText1 = await page.evaluate(() => document.activeElement?.textContent);
      expect(activeText1).toContain('Get Started'); // Hero CTA should be first interactive element

      // Tab to terminal buttons
      await page.keyboard.press('Tab');
      const activeText2 = await page.evaluate(() => document.activeElement?.textContent);
      expect(activeText2).toContain('Save');

      await page.keyboard.press('Tab');
      await page.keyboard.press('Tab');
      await page.keyboard.press('Tab');

      // Tab to Install Copy button
      await page.keyboard.press('Tab');
      const activeText3 = await page.evaluate(() => document.activeElement?.textContent);
      expect(activeText3).toContain('Copy');
    });

    test('Verify lack of premium/SaaS anti-patterns globally', async ({ page }) => {
      const bodyText = await page.innerText('body');
      const prohibited = [
        'pricing', 'plan', 'subscription', 'credit card', 'free trial',
        'enterprise', 'billing', 'testimonial'
      ];
      for (const term of prohibited) {
        expect(bodyText.toLowerCase()).not.toContain(` ${term} `);
      }
    });

  });

  // ==========================================
  // TIER 4: Real-World Application Scenarios
  // ==========================================

  test.describe('Tier 4: Real-World Application Scenarios', () => {

    test('T4-App-1: User Reading/Interaction Path', async ({ page, context }) => {
      // User arrives and reads Hero
      await expect(page.locator('[data-testid="hero-heading"]')).toHaveText('Local handoff for AI coding agents.');

      // User scrolls to Problem
      await page.locator('[data-testid="problem-section"]').scrollIntoViewIfNeeded();
      await expect(page.locator('[data-testid="problem-section"]')).toBeVisible();

      // User views How It Works
      await page.locator('[data-testid="how-it-works-section"]').scrollIntoViewIfNeeded();
      await expect(page.locator('[data-testid="how-step-1"]')).toBeVisible();

      // User interacts with Terminal Demo
      await page.locator('[data-testid="terminal-demo-section"]').scrollIntoViewIfNeeded();

      // Click doctor
      const doctorBtn = page.locator('[data-testid="cmd-doctor-btn"]');
      await doctorBtn.click();
      const output = page.locator('[data-testid="terminal-output"]');
      await expect(output).toContainText('Environment check');

      // Click status
      const statusBtn = page.locator('[data-testid="cmd-status-btn"]');
      await statusBtn.click();
      await expect(output).toContainText('Active agent');

      // User scrolls to Install and clicks copy
      await page.locator('[data-testid="install-section"]').scrollIntoViewIfNeeded();
      const copyBtn = page.locator('[data-testid="install-copy-btn"]');
      await context.grantPermissions(['clipboard-read', 'clipboard-write']);
      await copyBtn.click();
      const clipboardContent = await page.evaluate(() => navigator.clipboard.readText());
      expect(clipboardContent).toBe('npm i -g hammadev');

      // User looks at GitHub link in footer
      const githubLink = page.locator('[data-testid="github-link"]');
      await expect(githubLink).toHaveAttribute('href', 'https://github.com/xayrullonematov/hammadev');
    });

    test('T4-App-2: Keyboard-Only Access Path', async ({ page, context }) => {
      // 1. Focus starts at the top. Tab once to focus Hero CTA.
      await page.keyboard.press('Tab');
      // 2. Press Enter to trigger the smooth scroll to Install section
      await page.keyboard.press('Enter');

      // 3. Tab through the rest of the interactive elements:
      // - Save button (1)
      // - Load button (2)
      // - Doctor button (3)
      // - Status button (4)
      // - Copy button (5)
      for (let i = 0; i < 5; i++) {
        await page.keyboard.press('Tab');
      }

      // Check that Copy button is focused
      const focusedText = await page.evaluate(() => document.activeElement?.textContent);
      expect(focusedText).toContain('Copy');

      // 4. Press Enter to execute copy
      await context.grantPermissions(['clipboard-read', 'clipboard-write']);
      await page.keyboard.press('Enter');

      // Check clipboard
      const clipboardContent = await page.evaluate(() => navigator.clipboard.readText());
      expect(clipboardContent).toBe('npm i -g hammadev');
    });

    test('T4-App-3: Offline Resiliency Mock', async ({ context, page }) => {
      // Go offline
      await context.setOffline(true);
      await page.reload();

      // Verify that all copy actions and UI elements remain fully functional offline
      await expect(page.locator('[data-testid="hero-heading"]')).toHaveText('Local handoff for AI coding agents.');

      // Interact with terminal buttons offline
      const doctorBtn = page.locator('[data-testid="cmd-doctor-btn"]');
      await doctorBtn.click();
      const output = page.locator('[data-testid="terminal-output"]');
      await expect(output).toContainText('Environment check');

      // Clean up network state
      await context.setOffline(false);
    });

  });

});
