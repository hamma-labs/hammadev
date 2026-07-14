#!/usr/bin/env node
/**
 * Handoff Quality Guard - Main Entry Point
 *
 * This script is invoked by the Kiro hook on TypeScript file saves under src/.
 * It runs the full validation pipeline and generates a quality report.
 *
 * Uses only Node.js built-in modules for its own logic. Spawns pnpm commands
 * that rely on the project's installed dependencies.
 *
 * Exit codes:
 *   0 - All validations passed
 *   1 - One or more validations failed (report still written)
 */

import { execSync } from "node:child_process";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

import {
  detectComponents,
  assessRisks,
  generateReport,
  parseTestTotals,
  type ValidationStep,
  type ValidationResults,
} from "./report-generator.js";

// ─── Helpers ──────────────────────────────────────────────────────────────────

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const PROJECT_ROOT = resolve(__dirname, "..", "..");
const REPORT_DIR = resolve(PROJECT_ROOT, "docs", "generated");
const REPORT_PATH = resolve(REPORT_DIR, "handoff-quality-report.md");

interface CommandResult {
  status: "pass" | "fail";
  output: string;
  durationMs: number;
}

/**
 * Run a shell command and capture its result.
 * Never exposes environment variables or secrets in the output.
 */
function runCommand(command: string, cwd: string): CommandResult {
  const start = Date.now();
  try {
    const output = execSync(command, {
      cwd,
      encoding: "utf-8",
      stdio: ["pipe", "pipe", "pipe"],
      timeout: 120_000,
      env: {
        ...process.env,
        // Ensure consistent output
        FORCE_COLOR: "0",
        NO_COLOR: "1",
      },
    });
    return {
      status: "pass",
      output: sanitizeOutput(output),
      durationMs: Date.now() - start,
    };
  } catch (err: unknown) {
    const error = err as { stdout?: string; stderr?: string };
    const output = [error.stdout ?? "", error.stderr ?? ""].join("\n").trim();
    return {
      status: "fail",
      output: sanitizeOutput(output),
      durationMs: Date.now() - start,
    };
  }
}

/**
 * Remove potential secrets and environment variable values from command output.
 * Only retains structural information (counts, file paths, status lines).
 */
function sanitizeOutput(raw: string): string {
  // Remove lines that look like env var assignments
  const lines = raw.split("\n").filter((line) => {
    // Skip lines that look like secret assignments
    if (/^[A-Z_]+=./.test(line)) return false;
    // Skip lines containing common secret patterns
    if (/(?:sk-|ghp_|ghs_|xox[boapr]-|AKIA)[A-Za-z0-9]/.test(line))
      return false;
    return true;
  });
  return lines.join("\n").trim();
}

// ─── Git Diff Analysis ────────────────────────────────────────────────────────

/**
 * Get changed source files from git diff (staged + unstaged).
 * Returns paths relative to project root.
 */
function getChangedFiles(cwd: string): string[] {
  try {
    // Get both staged and unstaged changes, plus untracked files
    const diffOutput = execSync(
      "git diff --name-only HEAD 2>/dev/null || git diff --name-only",
      { cwd, encoding: "utf-8", stdio: ["pipe", "pipe", "pipe"] }
    ).trim();

    const stagedOutput = execSync("git diff --cached --name-only", {
      cwd,
      encoding: "utf-8",
      stdio: ["pipe", "pipe", "pipe"],
    }).trim();

    const allFiles = new Set<string>();
    for (const line of [...diffOutput.split("\n"), ...stagedOutput.split("\n")]) {
      const trimmed = line.trim();
      if (trimmed && trimmed.startsWith("src/") && trimmed.endsWith(".ts")) {
        allFiles.add(trimmed);
      }
    }

    return [...allFiles].sort();
  } catch {
    return [];
  }
}

// ─── Main Pipeline ────────────────────────────────────────────────────────────

function main(): void {
  const timestamp = new Date().toISOString();

  // Step 1: Get changed files
  const changedFiles = getChangedFiles(PROJECT_ROOT);

  // Step 2: Run validation steps
  const steps: ValidationStep[] = [];

  // Typecheck
  const typecheck = runCommand("pnpm typecheck", PROJECT_ROOT);
  steps.push({
    name: "Typecheck",
    command: "pnpm typecheck",
    status: typecheck.status,
    durationMs: typecheck.durationMs,
  });

  // Tests
  const tests = runCommand("pnpm test", PROJECT_ROOT);
  steps.push({
    name: "Tests",
    command: "pnpm test",
    status: tests.status,
    durationMs: tests.durationMs,
  });

  // Build
  const build = runCommand("pnpm build", PROJECT_ROOT);
  steps.push({
    name: "Build",
    command: "pnpm build",
    status: build.status,
    durationMs: build.durationMs,
  });

  // Smoke test (only if build passed)
  if (build.status === "pass") {
    const smoke = runCommand("node dist/cli.js --help", PROJECT_ROOT);
    steps.push({
      name: "Smoke Test",
      command: "node dist/cli.js --help",
      status: smoke.status,
      durationMs: smoke.durationMs,
    });
  } else {
    steps.push({
      name: "Smoke Test",
      command: "node dist/cli.js --help",
      status: "skipped",
      durationMs: 0,
    });
  }

  // Step 3: Parse test totals
  const testTotals = parseTestTotals(tests.output);

  // Step 4: Detect components
  const components = detectComponents(changedFiles);

  // Step 5: Assess risks
  const risks = assessRisks(components);

  // Step 6: Determine overall status
  const overallStatus = steps.some((s) => s.status === "fail") ? "fail" : "pass";

  // Step 7: Generate report
  const results: ValidationResults = {
    timestamp,
    changedFiles,
    steps,
    testTotals,
    components,
    risks,
    overallStatus,
  };

  const report = generateReport(results);

  // Step 8: Write report
  if (!existsSync(REPORT_DIR)) {
    mkdirSync(REPORT_DIR, { recursive: true });
  }
  writeFileSync(REPORT_PATH, report, "utf-8");

  // Step 9: Print summary to stdout
  console.log(`\nHandoff Quality Guard - ${overallStatus.toUpperCase()}`);
  console.log(`Report written to: ${REPORT_PATH}`);
  for (const step of steps) {
    const icon = step.status === "pass" ? "[PASS]" : step.status === "fail" ? "[FAIL]" : "[SKIP]";
    console.log(`  ${icon} ${step.name} (${(step.durationMs / 1000).toFixed(1)}s)`);
  }

  // Step 10: Exit with appropriate code
  if (overallStatus === "fail") {
    process.exit(1);
  }
}

main();
