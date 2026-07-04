import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  resolveCodexTarget,
  listCodexProjectCandidates,
} from "../../../src/adapters/codex/resolve.js";
import { discoverCodexSessions } from "../../../src/adapters/codex/discover.js";

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

describe("resolveCodexTarget — codex:project", () => {
  let projectHome = "";
  let projectA = "";
  let projectB = "";
  let strongPath = "";
  let metaPath = "";

  function rollout(cwd: string, userMessage: string, assistant: string): string {
    return [
      { type: "session_meta", payload: { id: "conv", cwd, timestamp: "2026-07-04T09:00:00Z" } },
      { type: "event_msg", payload: { type: "user_message", message: userMessage } },
      { type: "event_msg", payload: { type: "agent_message", message: assistant } },
    ]
      .map((record) => JSON.stringify(record))
      .join("\n") + "\n";
  }

  async function writeRollout(rel: string, contents: string, mtime: Date): Promise<string> {
    const full = path.join(projectHome, "sessions", rel);
    await fs.mkdir(path.dirname(full), { recursive: true });
    await fs.writeFile(full, contents);
    await fs.utimes(full, mtime, mtime);
    return full;
  }

  beforeAll(async () => {
    projectHome = await fs.mkdtemp(path.join(os.tmpdir(), "hamma-codex-project-"));
    projectA = await fs.mkdtemp(path.join(os.tmpdir(), "hamma-codex-proj-a-"));
    projectB = await fs.mkdtemp(path.join(os.tmpdir(), "hamma-codex-proj-b-"));

    strongPath = await writeRollout(
      "2026/07/04/rollout-2026-07-04T09-00-00-11111111-1111-4111-8111-111111111111.jsonl",
      rollout(
        projectA,
        "Implement the parser migration in src/parser.ts and add tests.",
        "Implementation is in progress."
      ),
      new Date("2026-07-04T09:05:00Z")
    );

    // Newer, but a Hamma handoff invocation → must be excluded.
    metaPath = await writeRollout(
      "2026/07/04/rollout-2026-07-04T10-00-00-22222222-2222-4222-8222-222222222222.jsonl",
      rollout(
        projectA,
        "Base directory for this skill: /home/u/.claude/skills/hamma-handoff\n\n# Hamma Handoff\n\nRecover the newest session and validate the generated handoff.",
        "Recovered a handoff."
      ),
      new Date("2026-07-04T10:05:00Z")
    );

    await writeRollout(
      "2026/07/04/rollout-2026-07-04T08-00-00-33333333-3333-4333-8333-333333333333.jsonl",
      rollout(projectB, "Work on an unrelated project.", "Working."),
      new Date("2026-07-04T08:05:00Z")
    );
  });

  afterAll(async () => {
    await Promise.all(
      [projectHome, projectA, projectB]
        .filter(Boolean)
        .map((item) => fs.rm(item, { recursive: true, force: true }))
    );
  });

  it("discovery extracts the recorded cwd as projectPathHint", async () => {
    const sessions = await discoverCodexSessions(projectHome);
    const strong = sessions.find((s) => s.path === strongPath);
    expect(strong?.projectPathHint).toBe(projectA);
  });

  it("selects the substantive project session, skipping the newer hamma-meta one", async () => {
    const out = await resolveCodexTarget("codex:project", {
      codexHome: projectHome,
      projectPath: projectA,
    });
    expect(out).toBe(strongPath);
  });

  it("marks the hamma-meta session non-resumable in the candidate list", async () => {
    const result = await listCodexProjectCandidates(projectA, projectHome);
    const meta = result.candidates.find((c) => c.path === metaPath);
    expect(meta).toMatchObject({ resumable: false, confidence: "low" });
    expect(meta?.signals).toContain("hamma-meta");
    expect(result.candidates[0].path).toBe(strongPath);
  });

  it("requires a project path", async () => {
    await expect(
      resolveCodexTarget("codex:project", { codexHome: projectHome })
    ).rejects.toThrow(/requires a project path/);
  });

  it("reports when a project has no Codex session", async () => {
    const missing = await fs.mkdtemp(path.join(os.tmpdir(), "hamma-codex-missing-"));
    try {
      await expect(
        resolveCodexTarget("codex:project", { codexHome: projectHome, projectPath: missing })
      ).rejects.toThrow(/No Codex session found for project/);
    } finally {
      await fs.rm(missing, { recursive: true, force: true });
    }
  });
});
