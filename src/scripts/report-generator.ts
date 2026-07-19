/**
 * Report generator for the Handoff Quality Guard.
 *
 * This module exports testable functions for:
 * - Detecting which HammaDev components are affected by changed files
 * - Assessing handoff-specific risks based on affected components
 * - Generating the Markdown quality report
 *
 * Uses only Node.js built-in modules.
 */

// ─── Types ────────────────────────────────────────────────────────────────────

export interface ComponentCategory {
  name: string;
  matchedFiles: string[];
}

export interface ValidationStep {
  name: string;
  command: string;
  status: "pass" | "fail" | "skipped";
  durationMs: number;
  output?: string;
}

export interface TestTotals {
  passed: number;
  failed: number;
  skipped: number;
}

export interface ValidationResults {
  timestamp: string;
  changedFiles: string[];
  steps: ValidationStep[];
  testTotals: TestTotals | null;
  components: ComponentCategory[];
  risks: string[];
  overallStatus: "pass" | "fail";
}

// ─── Component Detection ──────────────────────────────────────────────────────

interface ComponentRule {
  name: string;
  match: (filePath: string) => boolean;
}

const COMPONENT_RULES: ComponentRule[] = [
  {
    name: "Codex adapter",
    match: (f) => f.startsWith("src/adapters/codex/"),
  },
  {
    name: "Claude adapter",
    match: (f) => f.startsWith("src/adapters/claude/"),
  },
  {
    name: "handoff generation",
    match: (f) => f.startsWith("src/core/handoff"),
  },
  {
    name: "task-state extraction",
    match: (f) => f.startsWith("src/core/state"),
  },
  {
    name: "secret redaction",
    match: (f) => f === "src/core/redact.ts",
  },
  {
    name: "CLI commands",
    match: (f) => f === "src/cli.ts",
  },
  {
    name: "Git/project inspection",
    match: (f) =>
      f === "src/core/project-status.ts" || f === "src/core/project-match.ts",
  },
  {
    name: "artifact rendering",
    match: (f) =>
      f === "src/core/history.ts" ||
      (f.startsWith("src/core/") &&
        (f.includes("render") || f.includes("markdown"))),
  },
];

/**
 * Detect which HammaDev components are affected by the given changed file paths.
 */
export function detectComponents(changedFiles: string[]): ComponentCategory[] {
  const results: ComponentCategory[] = [];

  for (const rule of COMPONENT_RULES) {
    const matched = changedFiles.filter((f) => rule.match(f));
    if (matched.length > 0) {
      results.push({ name: rule.name, matchedFiles: matched });
    }
  }

  return results;
}

// ─── Risk Assessment ──────────────────────────────────────────────────────────

const RISK_MAP: Record<string, string[]> = {
  "Codex adapter": [
    "Changes to the Codex adapter may break session discovery or rollout parsing.",
    "Verify handoff from Codex still produces valid artifacts.",
  ],
  "Claude adapter": [
    "Changes to the Claude adapter may break JSONL parsing or session filtering.",
    "Verify handoff from Claude still produces valid artifacts.",
  ],
  "handoff generation": [
    "Core handoff logic changed - all handoff routes (codex-to-claude, claude-to-codex) should be retested.",
    "Check that generated handoff.md respects size caps and includes all required sections.",
  ],
  "task-state extraction": [
    "State extraction changes may alter the structured data passed to handoff rendering.",
    "Verify state.json output is still valid and complete.",
  ],
  "secret redaction": [
    "Redaction changes risk leaking sensitive data in handoff artifacts.",
    "Manually inspect a sample handoff output for unredacted API keys or tokens.",
  ],
  "CLI commands": [
    "CLI interface changes may break existing user workflows or scripts.",
    "Run the full smoke test suite and verify --help output.",
  ],
  "Git/project inspection": [
    "Project inspection changes may affect session discovery or status reporting.",
    "Verify hamma status and hamma list commands still work correctly.",
  ],
  "artifact rendering": [
    "Rendering changes may produce malformed or incomplete handoff documents.",
    "Compare before/after handoff.md output for a known session.",
  ],
};

/**
 * Assess handoff-specific risks based on affected components.
 */
export function assessRisks(components: ComponentCategory[]): string[] {
  const risks: string[] = [];

  for (const component of components) {
    const componentRisks = RISK_MAP[component.name];
    if (componentRisks) {
      risks.push(...componentRisks);
    }
  }

  if (components.length === 0) {
    risks.push(
      "No core handoff components directly affected, but integration behavior should still be verified."
    );
  }

  return risks;
}

// ─── Recommended Verification Steps ──────────────────────────────────────────

/**
 * Generate recommended manual verification steps based on affected components.
 */
export function getVerificationSteps(
  components: ComponentCategory[]
): string[] {
  const steps: string[] = [
    "Run `pnpm test` to confirm all unit tests pass.",
    "Run `pnpm smoke:cli` to verify compiled CLI binary.",
    "Run `pnpm smoke:package` to verify an isolated packed-package continuation.",
  ];

  const names = new Set(components.map((c) => c.name));

  if (names.has("Codex adapter") || names.has("handoff generation")) {
    steps.push(
      "Execute a Codex-to-Claude handoff and inspect the generated artifacts."
    );
  }
  if (names.has("Claude adapter") || names.has("handoff generation")) {
    steps.push(
      "Execute a Claude-to-Codex handoff and inspect the generated artifacts."
    );
  }
  if (names.has("secret redaction")) {
    steps.push(
      "Review redaction-report.md from a sample handoff for completeness."
    );
  }
  if (names.has("CLI commands")) {
    steps.push(
      "Verify all CLI commands listed in README still work as documented."
    );
  }
  if (names.has("artifact rendering")) {
    steps.push(
      "Compare rendered handoff.md against expected format and size limits."
    );
  }

  return steps;
}

// ─── Test Totals Parsing ──────────────────────────────────────────────────────

/**
 * Parse test totals from vitest output.
 * Looks for patterns like "Tests  5 passed | 1 failed | 2 skipped"
 * or "Tests  12 passed (12)"
 */
export function parseTestTotals(output: string): TestTotals | null {
  // Vitest output format: "Tests  X passed | Y failed | Z skipped (N)"
  const passedMatch = output.match(/(\d+)\s+passed/);
  const failedMatch = output.match(/(\d+)\s+failed/);
  const skippedMatch = output.match(/(\d+)\s+skipped/);

  if (!passedMatch && !failedMatch) {
    return null;
  }

  return {
    passed: passedMatch ? parseInt(passedMatch[1], 10) : 0,
    failed: failedMatch ? parseInt(failedMatch[1], 10) : 0,
    skipped: skippedMatch ? parseInt(skippedMatch[1], 10) : 0,
  };
}

// ─── Report Generation ────────────────────────────────────────────────────────

/**
 * Generate the Markdown quality report from validation results.
 * This function intentionally excludes any sensitive data:
 * - No environment variables
 * - No session contents or transcripts
 * - No secret values
 * - Only file paths, command names, and status information
 */
export function generateReport(results: ValidationResults): string {
  const lines: string[] = [];

  lines.push("# Handoff Quality Guard Report");
  lines.push("");
  lines.push(
    `**Generated:** ${results.timestamp}  `
  );
  lines.push(
    `**Overall Status:** ${results.overallStatus === "pass" ? "PASS" : "FAIL"}`
  );
  lines.push("");

  // Changed files
  lines.push("## Changed Source Files");
  lines.push("");
  if (results.changedFiles.length === 0) {
    lines.push("_No uncommitted source file changes detected._");
  } else {
    for (const file of results.changedFiles) {
      lines.push(`- \`${file}\``);
    }
  }
  lines.push("");

  // Validation results
  lines.push("## Validation Results");
  lines.push("");
  lines.push("| Step | Command | Status | Duration |");
  lines.push("|------|---------|--------|----------|");
  for (const step of results.steps) {
    const statusIcon =
      step.status === "pass"
        ? "PASS"
        : step.status === "fail"
          ? "FAIL"
          : "SKIPPED";
    const duration = `${(step.durationMs / 1000).toFixed(1)}s`;
    lines.push(
      `| ${step.name} | \`${step.command}\` | ${statusIcon} | ${duration} |`
    );
  }
  lines.push("");

  // Test totals
  if (results.testTotals) {
    lines.push("## Test Totals");
    lines.push("");
    lines.push(`- **Passed:** ${results.testTotals.passed}`);
    lines.push(`- **Failed:** ${results.testTotals.failed}`);
    lines.push(`- **Skipped:** ${results.testTotals.skipped}`);
    lines.push("");
  }

  // Affected components
  lines.push("## Affected Components");
  lines.push("");
  if (results.components.length === 0) {
    lines.push("_No core HammaDev components directly affected._");
  } else {
    for (const component of results.components) {
      lines.push(`### ${component.name}`);
      lines.push("");
      for (const file of component.matchedFiles) {
        lines.push(`- \`${file}\``);
      }
      lines.push("");
    }
  }

  // Risks
  lines.push("## Handoff-Specific Risks");
  lines.push("");
  if (results.risks.length === 0) {
    lines.push("_No specific risks identified._");
  } else {
    for (const risk of results.risks) {
      lines.push(`- ${risk}`);
    }
  }
  lines.push("");

  // Recommended verification steps
  const verificationSteps = getVerificationSteps(results.components);
  lines.push("## Recommended Manual Verification");
  lines.push("");
  for (let i = 0; i < verificationSteps.length; i++) {
    lines.push(`${i + 1}. ${verificationSteps[i]}`);
  }
  lines.push("");

  // Privacy notice
  lines.push("---");
  lines.push("");
  lines.push(
    "_This report contains only file paths, command names, and validation status. " +
      "No session contents, transcripts, secrets, or environment variables are included._"
  );
  lines.push("");

  return lines.join("\n");
}
