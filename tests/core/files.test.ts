import { describe, expect, it } from "vitest";
import { normalizeFilesMentioned } from "../../src/core/files.js";

describe("normalizeFilesMentioned", () => {
  it("dedups by basename preferring /src/ and drops artifact noise", () => {
    const input = [
      "session.json",
      "handoff.md",
      "state.json",
      "timeline.md",
      "commands.md",
      "redaction-report.md",
      "README.md",
      "troubleshooting.md",
      "doctor.ts",
      ".github/workflows/ci.yml",
      "examples/README.md",
      "src/core/foo.ts",
      "foo.ts",
      "src/session-loader.ts",
      "/home/user/project/src/core/bar.ts",
      "docs/troubleshooting.md"
    ];
    const out = normalizeFilesMentioned(input);
    expect(out).not.toContain("session.json");
    expect(out).not.toContain("handoff.md");
    expect(out).not.toContain("state.json");
    expect(out).not.toContain("timeline.md");
    expect(out).not.toContain("commands.md");
    expect(out).not.toContain("redaction-report.md");
    expect(out).not.toContain("README.md");
    expect(out).not.toContain("troubleshooting.md");
    expect(out).not.toContain("doctor.ts");
    expect(out).not.toContain(".github/workflows/ci.yml");
    expect(out).not.toContain("examples/README.md");
    expect(out).not.toContain("docs/troubleshooting.md");
    // prefers src version
    expect(out).toContain("src/core/foo.ts");
    expect(out.some((p: string) => p.includes("src/core/bar.ts"))).toBe(true);
    // no bare foo.ts if src present
    expect(out.filter((p: string) => p.endsWith("foo.ts"))).toEqual(["src/core/foo.ts"]);
  });

  it("returns empty for only noise", () => {
    const out = normalizeFilesMentioned(["session.json", "handoff.md", "README.md"]);
    expect(out).toEqual([]);
  });
});
