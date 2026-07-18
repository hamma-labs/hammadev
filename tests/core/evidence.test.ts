import { describe, expect, it } from "vitest";
import { renderHandoffMarkdown } from "../../src/core/handoff.js";
import {
  extractTaskState,
  HammaRepoState,
} from "../../src/core/state.js";
import { HammaSession } from "../../src/core/schema.js";

function state(
  overrides: Partial<HammaSession> = {},
  repoState: HammaRepoState = { warnings: [] }
) {
  const session: HammaSession = {
    meta: {
      sourceCli: "codex",
      sourceSessionId: "evidence-test",
      projectPath: "/tmp/evidence-test",
    },
    messages: [
      { role: "user", content: "Implement the parser and verify it." },
    ],
    shellCommands: [],
    parserWarnings: [],
    security: { redacted: false, redactionCount: 0, warnings: [] },
    ...overrides,
  };
  return extractTaskState(session, { targetCli: "claude", repoState });
}

describe("evidence provenance extraction", () => {
  it("labels assistant verification prose as a claim, not a command pass", () => {
    const result = state({
      messages: [
        { role: "user", content: "Implement and test the parser." },
        { role: "assistant", content: "All tests pass. Typecheck passed with no errors." },
      ],
    });

    expect(result.evidence.filter((item) => item.source === "agent_claim"))
      .toEqual(expect.arrayContaining([
        expect.objectContaining({ status: "claimed" }),
      ]));
    expect(result.evidence.some((item) => item.status === "passed")).toBe(false);
    expect(result.verification.join(" ")).toContain("agent claim");
  });

  it("uses an explicit zero exit code as passed command evidence", () => {
    const result = state({
      shellCommands: [{ command: "pnpm test", exitCode: 0 }],
    });
    expect(result.evidence).toContainEqual(
      expect.objectContaining({
        source: "command",
        kind: "tests",
        status: "passed",
        exitCode: 0,
      })
    );
    expect(result.verification).toContain("tests: command passed (exit 0)");
  });

  it("preserves failed and unknown command outcomes without promoting them", () => {
    const result = state({
      shellCommands: [
        { command: "pnpm typecheck", output: '{"exit_code":2}' },
        { command: "pnpm build", output: "output captured without an exit status" },
      ],
    });
    expect(result.evidence).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: "typecheck", status: "failed", exitCode: 2 }),
      expect.objectContaining({ kind: "build", status: "observed", exitCode: undefined }),
    ]));
  });

  it("distinguishes tool observations and user confirmations", () => {
    const result = state({
      messages: [
        { role: "user", content: "Implement the parser." },
        { role: "assistant", content: "The implementation is ready for review." },
        { role: "user", content: "Looks good." },
      ],
      shellCommands: [{ command: "git status --short", exitCode: 0 }],
    });
    expect(result.evidence).toEqual(expect.arrayContaining([
      expect.objectContaining({ source: "tool", status: "passed" }),
      expect.objectContaining({ source: "user_confirmation", status: "confirmed" }),
    ]));
  });

  it("records repository evidence and renders provenance counts", () => {
    const result = state({}, {
      warnings: [],
      snapshot: {
        version: 1,
        available: true,
        head: "abcdef0123456789",
        branch: "main",
        detachedHead: false,
        stagedFiles: [],
        unstagedFiles: [],
        untrackedFiles: [],
        changedFiles: [],
        changedFileDigests: [],
        relevantFiles: [],
        fingerprint: "fingerprint",
        warnings: [],
      },
    });
    expect(result.evidence).toContainEqual(
      expect.objectContaining({
        source: "repository",
        kind: "git_snapshot",
        status: "observed",
      })
    );
    const markdown = renderHandoffMarkdown(result, { compact: false });
    expect(markdown).toContain("## Evidence provenance");
    expect(markdown).toContain("repository: 1");
    expect(markdown).toContain("Claims are not equivalent");
  });
});
