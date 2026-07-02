import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { parseCodexRollout } from "../../../src/adapters/codex/rollout.js";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const FIXTURE = path.join(
  HERE,
  "fixtures",
  "rollout-2026-06-15T12-00-00-fixture-abc-123.jsonl"
);

describe("parseCodexRollout — basic fixture", () => {
  it("captures user and assistant messages in order", async () => {
    const session = await parseCodexRollout(FIXTURE);

    expect(session.messages).toHaveLength(2);
    expect(session.messages[0]).toMatchObject({
      role: "user",
      content: "hello, please list the files"
    });
    expect(session.messages[1]).toMatchObject({
      role: "assistant",
      content: "Sure — running ls now."
    });
  });

  it("captures the shell command and pairs its output", async () => {
    const session = await parseCodexRollout(FIXTURE);

    expect(session.shellCommands.length).toBeGreaterThanOrEqual(1);
    const first = session.shellCommands[0];
    expect(first.command).toContain("ls -la");
    expect(first.output).toContain("total 8");
  });

  it("ignores reasoning items without warnings and never surfaces internal thoughts", async () => {
    const session = await parseCodexRollout(FIXTURE);

    expect(session.parserWarnings).toHaveLength(0);

    const anyContentLeaked = session.messages.some((m) =>
      m.content.includes("internal chain of thought")
    );
    expect(anyContentLeaked).toBe(false);
  });

  it("detects projectPath from session_meta cwd", async () => {
    const session = await parseCodexRollout(FIXTURE);
    expect(session.meta.projectPath).toBe("/tmp/fake-project");
  });
});
