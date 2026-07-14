import { describe, expect, it } from "vitest";
import {
  detectComponents,
  assessRisks,
  generateReport,
  parseTestTotals,
  getVerificationSteps,
  type ComponentCategory,
  type ValidationResults,
} from "../../src/scripts/report-generator.js";

describe("detectComponents", () => {
  it("detects Codex adapter changes", () => {
    const result = detectComponents(["src/adapters/codex/parser.ts"]);
    expect(result).toHaveLength(1);
    expect(result[0].name).toBe("Codex adapter");
    expect(result[0].matchedFiles).toEqual(["src/adapters/codex/parser.ts"]);
  });

  it("detects Claude adapter changes", () => {
    const result = detectComponents(["src/adapters/claude/loader.ts"]);
    expect(result).toHaveLength(1);
    expect(result[0].name).toBe("Claude adapter");
  });

  it("detects handoff generation changes", () => {
    const result = detectComponents(["src/core/handoff.ts"]);
    expect(result).toHaveLength(1);
    expect(result[0].name).toBe("handoff generation");
  });

  it("detects handoff generation changes with prefix matching", () => {
    const result = detectComponents(["src/core/handoff-utils.ts"]);
    expect(result.some((c) => c.name === "handoff generation")).toBe(true);
    expect(result.find((c) => c.name === "handoff generation")!.matchedFiles).toEqual(["src/core/handoff-utils.ts"]);
  });

  it("detects task-state extraction changes", () => {
    const result = detectComponents(["src/core/state.ts"]);
    expect(result).toHaveLength(1);
    expect(result[0].name).toBe("task-state extraction");
  });

  it("detects task-state extraction changes with prefix matching", () => {
    const result = detectComponents(["src/core/state-utils.ts"]);
    expect(result).toHaveLength(1);
    expect(result[0].name).toBe("task-state extraction");
  });

  it("detects secret redaction changes", () => {
    const result = detectComponents(["src/core/redact.ts"]);
    expect(result).toHaveLength(1);
    expect(result[0].name).toBe("secret redaction");
  });

  it("detects CLI command changes", () => {
    const result = detectComponents(["src/cli.ts"]);
    expect(result).toHaveLength(1);
    expect(result[0].name).toBe("CLI commands");
  });

  it("detects Git/project inspection changes", () => {
    const result = detectComponents([
      "src/core/project-status.ts",
      "src/core/project-match.ts",
    ]);
    expect(result).toHaveLength(1);
    expect(result[0].name).toBe("Git/project inspection");
    expect(result[0].matchedFiles).toHaveLength(2);
  });

  it("detects artifact rendering changes via history.ts", () => {
    const result = detectComponents(["src/core/history.ts"]);
    expect(result).toHaveLength(1);
    expect(result[0].name).toBe("artifact rendering");
  });

  it("detects artifact rendering changes via render keyword", () => {
    const result = detectComponents(["src/core/render-utils.ts"]);
    expect(result).toHaveLength(1);
    expect(result[0].name).toBe("artifact rendering");
  });

  it("detects artifact rendering changes via markdown keyword in src/core/", () => {
    const result = detectComponents(["src/core/markdown-formatter.ts"]);
    expect(result).toHaveLength(1);
    expect(result[0].name).toBe("artifact rendering");
  });

  it("does NOT match artifact rendering for markdown files outside src/core/", () => {
    const result = detectComponents(["src/scripts/markdown-helper.ts"]);
    expect(result).toHaveLength(0);
  });

  it("does NOT match artifact rendering for render files outside src/core/", () => {
    const result = detectComponents(["src/scripts/render-quality.ts"]);
    expect(result).toHaveLength(0);
  });

  it("detects multiple components from mixed changes", () => {
    const result = detectComponents([
      "src/cli.ts",
      "src/core/redact.ts",
      "src/adapters/codex/index.ts",
    ]);
    expect(result.map((c) => c.name).sort()).toEqual(
      ["CLI commands", "Codex adapter", "secret redaction"].sort()
    );
  });

  it("returns empty array for unrelated files", () => {
    const result = detectComponents(["src/scripts/report-generator.ts"]);
    expect(result).toHaveLength(0);
  });

  it("returns empty array for empty input", () => {
    const result = detectComponents([]);
    expect(result).toHaveLength(0);
  });
});

describe("assessRisks", () => {
  it("returns risks for affected components", () => {
    const components: ComponentCategory[] = [
      { name: "secret redaction", matchedFiles: ["src/core/redact.ts"] },
    ];
    const risks = assessRisks(components);
    expect(risks.length).toBeGreaterThan(0);
    expect(risks.some((r) => r.includes("leak"))).toBe(true);
  });

  it("returns a default risk when no components affected", () => {
    const risks = assessRisks([]);
    expect(risks).toHaveLength(1);
    expect(risks[0]).toContain("integration behavior");
  });

  it("accumulates risks from multiple components", () => {
    const components: ComponentCategory[] = [
      { name: "Codex adapter", matchedFiles: ["src/adapters/codex/x.ts"] },
      { name: "Claude adapter", matchedFiles: ["src/adapters/claude/x.ts"] },
    ];
    const risks = assessRisks(components);
    expect(risks.length).toBeGreaterThanOrEqual(4);
  });
});

describe("parseTestTotals", () => {
  it("parses vitest output with passed and failed counts", () => {
    const output = "Tests  12 passed | 3 failed | 1 skipped (16)";
    const totals = parseTestTotals(output);
    expect(totals).toEqual({ passed: 12, failed: 3, skipped: 1 });
  });

  it("parses output with only passed tests", () => {
    const output = "Tests  8 passed (8)";
    const totals = parseTestTotals(output);
    expect(totals).toEqual({ passed: 8, failed: 0, skipped: 0 });
  });

  it("returns null when no test output found", () => {
    const totals = parseTestTotals("Build successful.");
    expect(totals).toBeNull();
  });
});

describe("getVerificationSteps", () => {
  it("always includes base verification steps", () => {
    const steps = getVerificationSteps([]);
    expect(steps.length).toBeGreaterThanOrEqual(2);
    expect(steps.some((s) => s.includes("pnpm test"))).toBe(true);
    expect(steps.some((s) => s.includes("smoke:cli"))).toBe(true);
  });

  it("adds handoff verification for adapter changes", () => {
    const components: ComponentCategory[] = [
      { name: "Codex adapter", matchedFiles: ["src/adapters/codex/x.ts"] },
    ];
    const steps = getVerificationSteps(components);
    expect(steps.some((s) => s.includes("Codex-to-Claude handoff"))).toBe(true);
  });

  it("adds redaction verification for secret redaction changes", () => {
    const components: ComponentCategory[] = [
      { name: "secret redaction", matchedFiles: ["src/core/redact.ts"] },
    ];
    const steps = getVerificationSteps(components);
    expect(steps.some((s) => s.includes("redaction-report"))).toBe(true);
  });
});

describe("generateReport", () => {
  const baseResults: ValidationResults = {
    timestamp: "2025-07-14T12:00:00.000Z",
    changedFiles: ["src/core/redact.ts", "src/cli.ts"],
    steps: [
      { name: "Typecheck", command: "pnpm typecheck", status: "pass", durationMs: 2500 },
      { name: "Tests", command: "pnpm test", status: "pass", durationMs: 4200 },
      { name: "Build", command: "pnpm build", status: "pass", durationMs: 1800 },
      { name: "Smoke Test", command: "node dist/cli.js --help", status: "pass", durationMs: 300 },
    ],
    testTotals: { passed: 15, failed: 0, skipped: 1 },
    components: [
      { name: "secret redaction", matchedFiles: ["src/core/redact.ts"] },
      { name: "CLI commands", matchedFiles: ["src/cli.ts"] },
    ],
    risks: [
      "Redaction changes risk leaking sensitive data in handoff artifacts.",
      "CLI interface changes may break existing user workflows or scripts.",
    ],
    overallStatus: "pass",
  };

  it("generates a valid Markdown report", () => {
    const report = generateReport(baseResults);
    expect(report).toContain("# Handoff Quality Guard Report");
    expect(report).toContain("**Overall Status:** PASS");
    expect(report).toContain("2025-07-14T12:00:00.000Z");
  });

  it("includes changed files section", () => {
    const report = generateReport(baseResults);
    expect(report).toContain("## Changed Source Files");
    expect(report).toContain("`src/core/redact.ts`");
    expect(report).toContain("`src/cli.ts`");
  });

  it("includes validation results table", () => {
    const report = generateReport(baseResults);
    expect(report).toContain("## Validation Results");
    expect(report).toContain("| Typecheck |");
    expect(report).toContain("PASS");
  });

  it("includes test totals", () => {
    const report = generateReport(baseResults);
    expect(report).toContain("## Test Totals");
    expect(report).toContain("**Passed:** 15");
    expect(report).toContain("**Failed:** 0");
    expect(report).toContain("**Skipped:** 1");
  });

  it("includes affected components", () => {
    const report = generateReport(baseResults);
    expect(report).toContain("## Affected Components");
    expect(report).toContain("### secret redaction");
    expect(report).toContain("### CLI commands");
  });

  it("includes risks", () => {
    const report = generateReport(baseResults);
    expect(report).toContain("## Handoff-Specific Risks");
    expect(report).toContain("leaking sensitive data");
  });

  it("includes recommended verification steps", () => {
    const report = generateReport(baseResults);
    expect(report).toContain("## Recommended Manual Verification");
  });

  it("includes privacy notice", () => {
    const report = generateReport(baseResults);
    expect(report).toContain("No session contents, transcripts, secrets");
  });

  it("does not contain environment variables or secrets", () => {
    const report = generateReport(baseResults);
    expect(report).not.toMatch(/process\.env/);
    expect(report).not.toMatch(/sk-[A-Za-z0-9]/);
    expect(report).not.toMatch(/ghp_[A-Za-z0-9]/);
    expect(report).not.toMatch(/API_KEY/);
  });

  it("shows FAIL status when overall status is fail", () => {
    const failResults: ValidationResults = {
      ...baseResults,
      overallStatus: "fail",
      steps: [
        ...baseResults.steps.slice(0, 1),
        { name: "Tests", command: "pnpm test", status: "fail", durationMs: 3000 },
        ...baseResults.steps.slice(2),
      ],
    };
    const report = generateReport(failResults);
    expect(report).toContain("**Overall Status:** FAIL");
    expect(report).toContain("FAIL");
  });

  it("handles empty changed files", () => {
    const emptyResults: ValidationResults = {
      ...baseResults,
      changedFiles: [],
      components: [],
    };
    const report = generateReport(emptyResults);
    expect(report).toContain("No uncommitted source file changes detected");
  });
});
