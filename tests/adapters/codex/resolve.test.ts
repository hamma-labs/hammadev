import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { resolveCodexTarget } from "../../../src/adapters/codex/resolve.js";

interface Fixture {
  id: string;
  date: string; // YYYY/MM/DD
  timestamp: string; // YYYY-MM-DDTHH-MM-SS
  mtime: Date;
}

const FIXTURES: Fixture[] = [
  {
    id: "aaaa-1111",
    date: "2026/06/01",
    timestamp: "2026-06-01T10-00-00",
    mtime: new Date("2026-06-01T10:00:00Z")
  },
  {
    id: "aaaa-2222",
    date: "2026/06/02",
    timestamp: "2026-06-02T10-00-00",
    mtime: new Date("2026-06-02T10:00:00Z")
  },
  {
    id: "bbbb-3333",
    date: "2026/06/03",
    timestamp: "2026-06-03T10-00-00",
    mtime: new Date("2026-06-03T10:00:00Z")
  }
];

let codexHome = "";
const filePaths = new Map<string, string>();

beforeAll(async () => {
  codexHome = await fs.mkdtemp(path.join(os.tmpdir(), "hamma-resolve-"));

  for (const f of FIXTURES) {
    const dir = path.join(codexHome, "sessions", f.date);
    await fs.mkdir(dir, { recursive: true });
    const file = path.join(dir, `rollout-${f.timestamp}-${f.id}.jsonl`);
    await fs.writeFile(file, "");
    await fs.utimes(file, f.mtime, f.mtime);
    filePaths.set(f.id, file);
  }
});

afterAll(async () => {
  if (codexHome) await fs.rm(codexHome, { recursive: true, force: true });
});

describe("resolveCodexTarget — codex: targets", () => {
  it("codex:last resolves the newest session by mtime", async () => {
    const out = await resolveCodexTarget("codex:last", { codexHome });
    expect(out).toBe(filePaths.get("bbbb-3333"));
  });

  it("codex:<exact-id> resolves the exact match", async () => {
    const out = await resolveCodexTarget("codex:aaaa-1111", { codexHome });
    expect(out).toBe(filePaths.get("aaaa-1111"));
  });

  it("codex:<unique-prefix> resolves when only one id matches the prefix", async () => {
    const out = await resolveCodexTarget("codex:bbb", { codexHome });
    expect(out).toBe(filePaths.get("bbbb-3333"));
  });

  it("ambiguous prefix throws a clear error listing matches", async () => {
    await expect(resolveCodexTarget("codex:aaaa", { codexHome })).rejects.toThrow(
      /Ambiguous Codex conversationId prefix 'aaaa'/
    );

    try {
      await resolveCodexTarget("codex:aaaa", { codexHome });
    } catch (err: any) {
      expect(err.message).toContain("aaaa-1111");
      expect(err.message).toContain("aaaa-2222");
    }
  });

  it("unknown id throws a clear not-found error", async () => {
    await expect(resolveCodexTarget("codex:zzzz", { codexHome })).rejects.toThrow(
      /No Codex session found with conversationId matching 'zzzz'/
    );
  });
});

describe("resolveCodexTarget — direct file paths", () => {
  it("resolves a real rollout-*.jsonl path to its absolute form", async () => {
    const target = filePaths.get("aaaa-1111")!;
    const out = await resolveCodexTarget(target);
    expect(out).toBe(path.resolve(target));
  });

  it("rejects a non-.jsonl path", async () => {
    const bad = path.join(codexHome, "rollout-something.txt");
    await expect(resolveCodexTarget(bad)).rejects.toThrow(/\.jsonl extension/);
  });

  it("rejects a .jsonl file whose basename does not start with rollout-", async () => {
    const dir = path.join(codexHome, "misc");
    await fs.mkdir(dir, { recursive: true });
    const bad = path.join(dir, "not-a-rollout.jsonl");
    await fs.writeFile(bad, "");
    await expect(resolveCodexTarget(bad)).rejects.toThrow(
      /basename must start with 'rollout-'/
    );
  });

  it("rejects a well-named rollout path that does not exist on disk", async () => {
    const bad = path.join(codexHome, "sessions/2000/01/01/rollout-2000-01-01T00-00-00-ghost.jsonl");
    await expect(resolveCodexTarget(bad)).rejects.toThrow(/does not exist/);
  });
});
