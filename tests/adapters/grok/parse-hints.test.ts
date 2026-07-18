import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { parseGrokSession } from "../../../src/adapters/grok/parse.js";
import { extractTaskState } from "../../../src/core/state.js";
import { MAX_SESSION_BYTES } from "../../../src/core/session-limits.js";

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map((r) => fs.rm(r, { recursive: true, force: true })));
});

async function makeTempGrokSession(id: string, chatContent: string): Promise<string> {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "hamma-grok-parse-hints-"));
  roots.push(root);
  const sessDir = path.join(root, "sessions", "dummy", id);
  await fs.mkdir(sessDir, { recursive: true });
  const summary = { info: { id } };
  await fs.writeFile(path.join(sessDir, "summary.json"), JSON.stringify(summary));
  await fs.writeFile(path.join(sessDir, "chat_history.jsonl"), chatContent + "\n");
  return sessDir;
}

describe("grok parse hints + extract (stable temp-dir, shipped paths)", () => {
  it("parseGrokSession attaches extractionHints; extract uses it for unique marker (no heuristics param)", async () => {
    const id = "424242-1111-4aaa-8aaa-424242424242";
    const marker = "HammaGrokHintProof #424242 marker-phase-only";
    const dir = await makeTempGrokSession(id, `{"type":"assistant","content":"... ${marker} ..."}`);
    const parsed = await parseGrokSession(dir);
    expect(parsed.extractionHints).toBeDefined();
    expect(Array.isArray(parsed.extractionHints?.completedPatterns)).toBe(true);

    const state = extractTaskState(parsed, { targetCli: "claude", repoState: { warnings: [] } });
    expect(state.tasks.some((t: any) => (t.id === "424242" || (t.summary || "").includes("424242") || (t.summary || "").includes("HammaGrokHintProof")))).toBe(true);

    // without hints the unique marker does not create the task
    const no = { ...parsed, extractionHints: undefined };
    const stateNo = extractTaskState(no, { targetCli: "claude", repoState: { warnings: [] } });
    const hasMarker = stateNo.tasks.some((t: any) => (t.summary || "").includes("HammaGrokHintProof"));
    expect(hasMarker).toBe(false);
  });

  it("extends universal task patterns instead of replacing them", async () => {
    const id = "525252-1111-4aaa-8aaa-525252525252";
    const content = "Task #1 completed in src/server.ts. Task #2 remains. Next action: document GET /health in README.md.";
    const dir = await makeTempGrokSession(
      id,
      JSON.stringify({ type: "assistant", content })
    );

    const parsed = await parseGrokSession(dir);
    const state = extractTaskState(parsed, {
      targetCli: "codex",
      repoState: { warnings: [] },
    });

    expect(state.tasks).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: "1", status: "completed" }),
      expect.objectContaining({ id: "2", status: "remaining" }),
    ]));
    expect(state.nextAction).toBe("document GET /health in README.md.");
  });

  it("parseGrokSession rejects oversized chat_history.jsonl with 50 MiB error (drives MAX in parse)", async () => {
    const id = "999999-1111-4aaa-8aaa-999999999999";
    const dir = await makeTempGrokSession(id, "small");
    const chat = path.join(dir, "chat_history.jsonl");
    await fs.truncate(chat, MAX_SESSION_BYTES + 1);
    await expect(parseGrokSession(dir)).rejects.toThrow("exceeds the 50 MiB limit");
  });
});
