# E2E Test Suite Verification Guide: HammaDev Landing Page

This file provides details on the implemented Playwright E2E test suite, the coverage checklist, and instructions to run and verify the tests.

## Test Runner Commands

You can run the tests using either of the following commands:

- From the repository root directory:
  ```bash
  pnpm --prefix website test:e2e
  ```
- Or navigate to the `website/` directory and run:
  ```bash
  cd website
  pnpm install
  npx playwright install chromium
  pnpm test:e2e
  ```

*Note: Playwright's config is configured to launch the local Vite server (`pnpm dev`) automatically, run the tests, and shut down.*

## E2E Test Coverage Checklist

### Tier 1: Feature Coverage (50+ assertions)
- [x] **Hero Section**:
  - Exact heading copy: "Local handoff for AI coding agents."
  - Subheading contains "Codex", "Claude Code", and "100% local handoff".
  - CTA button visible and says "Get Started".
  - Monospace code block visible.
  - "Alpha" tag/label present.
- [x] **Problem Section**:
  - Heading exists.
  - Subheading/details mention "context loss".
  - 3 key pain points listed.
  - Layout is rendered and visible.
  - No overhype/fake testimonials.
- [x] **How It Works**:
  - Heading exists.
  - 3 steps exist (Save, Choose, Load).
  - Ordering is correct.
  - Visual flow representation/diagram present.
- [x] **Terminal Demo**:
  - Heading exists.
  - Terminal console mock container exists.
  - Interactive CLI command buttons exist (Save, Load, Doctor, Status).
  - CLI command buttons update the terminal console output text.
  - Commands `hamma save --agent codex` and `hamma load --agent claude` are shown in demo.
- [x] **Features**:
  - Heading exists.
  - Exactly 6 feature cards displayed.
  - specific cards for "100% Local", "Zero-Backend", and "Context Redaction".
- [x] **Safety Model**:
  - Heading exists.
  - Mentions "best-effort redaction" honestly.
  - States no cloud uploads are made.
  - Security/encryption details are described.
- [x] **Install**:
  - Heading exists.
  - Command `npm i -g hammadev` is present.
  - Copy button exists and functions.
  - Clipboard write/read verified.
  - Visual copy feedback ("Copied!") verified.
- [x] **Alpha Limitations**:
  - Heading exists.
  - Disclaimer of "alpha" software.
  - Mentions "best-effort redaction" honestly.
  - States "no backend" or "pure local CLI".
- [x] **Roadmap**:
  - Heading exists.
  - v0.1, v0.2, v0.3, v1.0 stages listed.
  - Styled in a grid/timeline.
  - chronological ordering verified.
- [x] **Footer & Final CTA**:
  - Final CTA button exists.
  - GitHub link points exactly to: https://github.com/xayrullonematov/hammadev
  - npm link points exactly to: https://www.npmjs.com/package/hammadev
  - License info is present.
  - No pricing, signup, or login links.

### Tier 2: Boundary & Corner Cases
- [x] Responsive layout verified across 5+ viewports:
  - Desktop: 1440x900
  - Tablet: 768x1024
  - Mobile: 375x812
  - Extra Large: 1920x1080
  - Small Mobile: 320x568
- [x] Verified zero horizontal layout overflow across all viewports.
- [x] Verify external links have secure tags: `target="_blank" rel="noopener noreferrer"`.
- [x] Verify rapid button click handling in Interactive Terminal Demo.

### Tier 3: Cross-Feature Combinations
- [x] Uniform typography (sans-serif) and dark background colors across all 10 sections.
- [x] Smooth scrolling from Hero CTA to Install section.
- [x] Consistent monospace font check in Hero, Terminal, and Install code blocks.
- [x] Keyboard focus navigation (tab flow).
- [x] Lack of marketing/premium/SaaS patterns globally.

### Tier 4: Real-World Scenarios
- [x] User scanning/reading & interactive journey.
- [x] Keyboard-only user access path.
- [x] Offline resiliency verification (mocking offline state and verifying static functions remain operational).

## Verification Method

1. Install dependencies:
   ```bash
   pnpm --prefix website install
   npx playwright install chromium
   ```
2. Run the E2E tests:
   ```bash
   pnpm --prefix website test:e2e
   ```
3. Playwright will automatically start Vite to serve the mock `index.html` on `http://localhost:5173`, run the tests, and output the results.
