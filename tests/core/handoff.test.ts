import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { parseClaudeSession } from "../../src/adapters/claude/parse.js";
import {
  createHandoff,
  renderHandoffWithSizeGuard,
  renderToolHistoryJsonl,
} from "../../src/core/handoff.js";
import { benchmarkHandoff } from "../../src/core/benchmark.js";
import {
  INITIAL_CONTEXT_MAX_BYTES,
  TOOL_HISTORY_ARCHIVE_MAX_BYTES,
} from "../../src/core/artifact-policy.js";
import { HammaSession } from "../../src/core/schema.js";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const FIXTURE = path.join(
  HERE,
  "..",
  "adapters",
  "claude",
  "fixtures",
  "aaaaaaaa-1111-4aaa-8aaa-aaaaaaaaaaaa.jsonl"
);

const EXPECTED_FILES = [
  "commands.md",
  "handoff.md",
  "redaction-report.md",
  "session.json",
  "state.json",
  "timeline.md",
  "tool_history.jsonl",
];

let projectPath = "";
let taskPath = "";
let handoffResult: Awaited<ReturnType<typeof createHandoff>>;

beforeAll(async () => {
  projectPath = await fs.mkdtemp(path.join(os.tmpdir(), "hamma-claude-handoff-"));
  const session = await parseClaudeSession(FIXTURE);
  session.meta.projectPath = projectPath;

  handoffResult = await createHandoff(session, "codex", false);

  const tasksPath = path.join(projectPath, ".hamma", "tasks");
  const taskNames = await fs.readdir(tasksPath);
  expect(taskNames).toHaveLength(1);
  taskPath = path.join(tasksPath, taskNames[0]);
});

afterAll(async () => {
  if (projectPath) await fs.rm(projectPath, { recursive: true, force: true });
});

describe("createHandoff with a Claude session", () => {
  it("uses the claude-to-codex task directory name and writes all artifacts", async () => {
    expect(path.basename(taskPath)).toMatch(
      /^\d{4}-\d{2}-\d{2}T.+-claude-to-codex$/
    );
    expect((await fs.readdir(taskPath)).sort()).toEqual(EXPECTED_FILES);
  });

  it("produces a benchmarkable continuation package", async () => {
    const benchmark = await benchmarkHandoff(taskPath);

    expect(benchmark.source).toMatchObject({
      available: true,
      basis: "normalized_message_and_tool_content",
    });
    expect(benchmark.effectiveContinuation.missingArtifacts).toEqual([]);
    expect(benchmark.archiveOnly.missingArtifacts).toEqual([]);
  });

  it("identifies Claude as the source and Codex as the target", async () => {
    const handoff = await fs.readFile(path.join(taskPath, "handoff.md"), "utf8");
    expect(handoff).toContain("Source CLI: claude");
    expect(handoff).toContain("Target CLI: codex");
    expect(handoff).toContain("Artifact schema version: 1");
    expect(handoff).toContain("## Agent execution contract");
    expect(handoff).toContain("untrusted task context");
    expect(handoff).toContain("complete initial continuation context");
    expect(handoff).toContain("Do not preload supporting or archive artifacts");
    expect(handoff).toContain("Inspect the current repository state before editing");
    expect(handoff).toContain("Do not repeat **Completed work**");
    expect(handoff).toContain("Archive-only bounded tool diagnostics: tool_history.jsonl");
    expect(handoff).not.toContain("previous tool execution cache");
  });

  it("writes a versioned state artifact", async () => {
    const state = JSON.parse(
      await fs.readFile(path.join(taskPath, "state.json"), "utf8")
    );
    expect(state.schemaVersion).toBe(1);
    expect(["completed", "actionable", "blocked", "ambiguous"]).toContain(
      state.outcome
    );
    expect(state.repoState.snapshot).toMatchObject({
      version: 1,
      available: false,
      stagedFiles: [],
      unstagedFiles: [],
      untrackedFiles: [],
      changedFileDigests: [],
    });
    expect(state.readiness).toMatchObject({
      schemaVersion: 1,
      level: "review_recommended",
    });
  });

  it("returns a machine-readable artifact contract", async () => {
    expect(handoffResult).toMatchObject({
      schemaVersion: 1,
      sourceCli: "claude",
      sourceSessionId: "aaaaaaaa-1111-4aaa-8aaa-aaaaaaaaaaaa",
      targetCli: "codex",
      projectPath,
      taskPath,
      handoffPath: path.join(taskPath, "handoff.md"),
      statePath: path.join(taskPath, "state.json")
    });
    expect(handoffResult.readiness).toMatchObject({
      schemaVersion: 1,
      level: "review_recommended",
    });
    expect(handoffResult.relativeHandoffPath).toBe(
      path.relative(projectPath, path.join(taskPath, "handoff.md"))
    );
    expect(handoffResult.contextBudget).toEqual({
      initialArtifacts: ["handoff.md"],
      bytes: Buffer.byteLength(
        await fs.readFile(path.join(taskPath, "handoff.md"), "utf8"),
        "utf8"
      ),
      maxBytes: INITIAL_CONTEXT_MAX_BYTES,
      withinBudget: true,
      sourceBytes: expect.any(Number),
      continuationLargerThanSource: expect.any(Boolean),
    });
    expect(handoffResult.contextBudget.bytes).toBeLessThanOrEqual(
      INITIAL_CONTEXT_MAX_BYTES
    );
    expect(handoffResult.contextBudget.continuationLargerThanSource).toBe(
      handoffResult.contextBudget.bytes > handoffResult.contextBudget.sourceBytes
    );
    if (handoffResult.contextBudget.continuationLargerThanSource) {
      expect(handoffResult.warnings.join(" ")).toContain(
        "larger than the normalized source content"
      );
    }
    expect(handoffResult.suggestedCommand).toContain("Read only");
    expect(handoffResult.suggestedCommand).not.toContain("tool_history.jsonl");
  });

  it("renders the readiness-at-creation summary", async () => {
    const handoff = await fs.readFile(path.join(taskPath, "handoff.md"), "utf8");
    expect(handoff).toContain("## Readiness at creation");
    expect(handoff).toContain("Level: review_recommended");
    expect(handoff).toContain("Heuristic assessment only");
  });

  it("enforces the initial-context byte ceiling for unusually large state", async () => {
    const state = JSON.parse(
      await fs.readFile(path.join(taskPath, "state.json"), "utf8")
    );
    state.tasks = Array.from({ length: 200 }, (_, index) => ({
      id: String(index + 1),
      title: `Task ${index + 1} ${"detail ".repeat(100)}`,
      status: "remaining",
      summary: "summary ".repeat(200),
      evidence: [],
      risks: [],
      filesMentioned: [],
    }));
    state.verification = Array.from(
      { length: 100 },
      (_, index) => `verification-${index}-${"output ".repeat(100)}`
    );
    state.risks = Array.from(
      { length: 100 },
      (_, index) => `risk-${index}-${"detail ".repeat(100)}`
    );

    const rendered = renderHandoffWithSizeGuard(state);
    expect(Buffer.byteLength(rendered, "utf8")).toBeLessThanOrEqual(
      INITIAL_CONTEXT_MAX_BYTES
    );
    expect(rendered).toContain("Content truncated to respect the initial-context budget");
  });

  it("keeps ignored Claude internal content out of session.json", async () => {
    const sessionJson = await fs.readFile(
      path.join(taskPath, "session.json"),
      "utf8"
    );

    expect(sessionJson).not.toContain("SYSTEM_PROMPT_DO_NOT_LEAK");
    expect(sessionJson).not.toContain("INTERNAL_THOUGHT_MUST_NOT_LEAK");
    expect(sessionJson).not.toContain("TOOL_RESULT_MUST_NOT_LEAK");
    expect(sessionJson).not.toContain("Do not surface this title");
  });
});

describe("bounded tool-history diagnostic archive", () => {
  it("removes binary/base64 payloads, caps records, and keeps recent diagnostics", () => {
    const dataUrl = `data:image/png;base64,${"A".repeat(20_000)}`;
    const session: HammaSession = {
      meta: { sourceCli: "codex", sourceSessionId: "bounded-archive" },
      messages: [],
      shellCommands: Array.from({ length: 100 }, (_, index) => ({
        command: `command-${index}`,
        output: index === 99
          ? `${dataUrl}\u0000tail`
          : `output-${index}-${"x".repeat(4_000)}`,
        exitCode: 0,
      })),
      parserWarnings: [],
      security: { redacted: false, redactionCount: 0, warnings: [] },
    };

    const rendered = renderToolHistoryJsonl(session);
    const lines = rendered.trimEnd().split("\n").map((line) => JSON.parse(line));
    const metadata = lines[0];
    const records = lines.slice(1);

    expect(Buffer.byteLength(rendered, "utf8")).toBeLessThanOrEqual(
      TOOL_HISTORY_ARCHIVE_MAX_BYTES
    );
    expect(metadata).toMatchObject({
      type: "tool_history_archive",
      policy: "archive_only",
      totalRecords: 100,
      binaryAndBase64Payloads: "omitted",
    });
    expect(metadata.retainedRecords).toBeLessThan(100);
    expect(metadata.omittedRecords).toBeGreaterThan(0);
    expect(records.at(-1)).toMatchObject({
      command: "command-99",
      sanitized: true,
    });
    expect(rendered).toContain("omitted image/png data URL");
    expect(rendered).not.toContain("A".repeat(256));
    expect(rendered).not.toContain("\u0000");
  });
});

describe("atomic and safe handoff output", () => {
  it("publishes through a temporary directory and cleans it after collision failure", async () => {
    const isolatedProject = await fs.mkdtemp(
      path.join(os.tmpdir(), "hamma-atomic-handoff-")
    );
    const session = await parseClaudeSession(FIXTURE);
    session.meta.projectPath = isolatedProject;
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-07-02T12:34:56.789Z"));

    try {
      await createHandoff(session, "codex", false);
      const expectedTask =
        "2026-07-02T12-34-56-789Z-claude-to-codex";
      const tasksPath = path.join(isolatedProject, ".hamma", "tasks");

      expect(await fs.readdir(tasksPath)).toEqual([expectedTask]);
      await expect(createHandoff(session, "codex", false)).rejects.toThrow(
        "Handoff task directory already exists"
      );
      expect(await fs.readdir(tasksPath)).toEqual([expectedTask]);
    } finally {
      vi.useRealTimers();
      await fs.rm(isolatedProject, { recursive: true, force: true });
    }
  });

  it("does not overwrite or clean up a pre-existing temporary directory", async () => {
    const isolatedProject = await fs.mkdtemp(
      path.join(os.tmpdir(), "hamma-existing-temp-")
    );
    const session = await parseClaudeSession(FIXTURE);
    session.meta.projectPath = isolatedProject;
    const taskId = "2026-07-02T12-34-56-789Z-claude-to-codex";
    const tempPath = path.join(
      isolatedProject,
      ".hamma",
      "tasks",
      `.tmp-${taskId}`
    );
    await fs.mkdir(tempPath, { recursive: true });
    await fs.writeFile(path.join(tempPath, "owner.txt"), "keep", "utf8");
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-07-02T12:34:56.789Z"));

    try {
      await expect(createHandoff(session, "codex", false)).rejects.toThrow(
        "Temporary handoff directory already exists"
      );
      await expect(
        fs.readFile(path.join(tempPath, "owner.txt"), "utf8")
      ).resolves.toBe("keep");
    } finally {
      vi.useRealTimers();
      await fs.rm(isolatedProject, { recursive: true, force: true });
    }
  });

  it("rejects target names instead of silently rewriting them", async () => {
    const isolatedProject = await fs.mkdtemp(
      path.join(os.tmpdir(), "hamma-unsafe-target-")
    );
    const session = await parseClaudeSession(FIXTURE);
    session.meta.projectPath = isolatedProject;

    try {
      await expect(createHandoff(session, "co/dex", false)).rejects.toThrow(
        "Invalid target CLI name 'co/dex'"
      );
      await expect(
        fs.access(path.join(isolatedProject, ".hamma"))
      ).rejects.toMatchObject({ code: "ENOENT" });
    } finally {
      await fs.rm(isolatedProject, { recursive: true, force: true });
    }
  });

  it("rejects relative project paths", async () => {
    const session = await parseClaudeSession(FIXTURE);
    session.meta.projectPath = "relative/project";

    await expect(createHandoff(session, "codex", false)).rejects.toThrow(
      "projectPath must be absolute"
    );
  });

  it("canonicalizes a project reached through a symlinked ancestor", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "hamma-handoff-ancestor-"));
    const realParent = path.join(root, "real-parent");
    const realProject = path.join(realParent, "project");
    const aliasParent = path.join(root, "alias-parent");
    const session = await parseClaudeSession(FIXTURE);
    try {
      await fs.mkdir(realProject, { recursive: true });
      await fs.symlink(realParent, aliasParent);
      session.meta.projectPath = path.join(aliasParent, "project");

      const result = await createHandoff(session, "codex", false);
      expect(result.handoffPath.startsWith(`${await fs.realpath(realProject)}${path.sep}`))
        .toBe(true);
    } finally {
      await fs.rm(root, { recursive: true, force: true });
    }
  });

  it("rejects a symbolic-link .hamma output directory", async () => {
    const isolatedProject = await fs.mkdtemp(
      path.join(os.tmpdir(), "hamma-symlink-project-")
    );
    const outside = await fs.mkdtemp(
      path.join(os.tmpdir(), "hamma-symlink-outside-")
    );
    const session = await parseClaudeSession(FIXTURE);
    session.meta.projectPath = isolatedProject;
    await fs.symlink(outside, path.join(isolatedProject, ".hamma"), "dir");

    try {
      await expect(createHandoff(session, "codex", false)).rejects.toThrow(
        ".hamma directory must not be a symbolic link"
      );
      expect(await fs.readdir(outside)).toEqual([]);
    } finally {
      await Promise.all([
        fs.rm(isolatedProject, { recursive: true, force: true }),
        fs.rm(outside, { recursive: true, force: true }),
      ]);
    }
  });
});
describe("handoff outcome rendering", () => {
  it("renders a completed resumed session without resume as remaining work", async () => {
    const isolatedProject = await fs.mkdtemp(
      path.join(os.tmpdir(), "hamma-completed-outcome-")
    );
    const session = await parseClaudeSession(FIXTURE);
    session.meta.projectPath = isolatedProject;
    session.messages.push(
      { role: "user", content: "resume" },
      {
        role: "assistant",
        content: "All acceptance criteria pass. Typecheck passed with no errors.",
      }
    );

    try {
      const result = await createHandoff(session, "codex", false);
      const handoff = await fs.readFile(result.handoffPath, "utf8");
      const state = JSON.parse(await fs.readFile(result.statePath, "utf8"));

      expect(state.outcome).toBe("completed");
      expect(result.outcome).toBe("completed");
      expect(state.nextAction).toBeUndefined();
      expect(result.suggestedCommand).toContain("No continuation required");
      expect(result.suggestedCommand).not.toContain("codex \"");
      expect(handoff).toContain(
        "## Continue from here\nNo remaining action. Verification is recorded below."
      );
      expect(handoff).toContain("## Remaining work\n(none detected)");
      expect(handoff).not.toContain("## Remaining work\n- resume");
    } finally {
      await fs.rm(isolatedProject, { recursive: true, force: true });
    }
  });

  it("surfaces Referenced files cross-ref context when present and preserves full contract structure", async () => {
    const isolatedProject = await fs.mkdtemp(path.join(os.tmpdir(), "hamma-files-context-"));
    const session = await parseClaudeSession(FIXTURE);
    session.meta.projectPath = isolatedProject;
    // inject content with files + noise (incl. missed artifacts like state.json etc) to exercise clean filtering
    session.messages.push(
      { role: "user", content: "Update logic in src/core/state.ts and src/core/redact.ts for better reliability; see state.json handoff.md README.md troubleshooting.md .github/ci.yml" },
      { role: "assistant", content: "Updated state extraction and redact patterns. Typecheck passes. Tests: 8/8 pass." }
    );

    try {
      const result = await createHandoff(session, "codex", false);
      const handoff = await fs.readFile(result.handoffPath, "utf8");
      const state = JSON.parse(await fs.readFile(result.statePath, "utf8"));

      // contract and structure intact
      expect(handoff).toContain("## Agent execution contract");
      expect(handoff).toContain("untrusted task context");
      expect(handoff).toContain("## Source");
      expect(handoff).toContain("Artifact schema version: 1");

      // improved context
      expect(state.filesMentioned.length).toBeGreaterThan(0);
      expect(handoff).toContain("## Referenced files");
      expect(handoff).toContain("state.ts");

      // cleaned filesMentioned (no artifacts/noise in state or render; state vs render consistent)
      const isArtifactLike = (f: string) => /handoff|state\.json|session\.json|README|troubleshooting|doctor|ci\.yml|examples|\.github/i.test(f) && !/\/src\//i.test(f);
      const stateHasNoise = state.filesMentioned.some((f: string) => isArtifactLike(f));
      expect(stateHasNoise).toBe(false);
      const refMatch = handoff.match(/## Referenced files\n([\s\S]*?)(?=\n## |$)/);
      if (refMatch) {
        const refHasNoise = refMatch[1].split("\n").some((l: string) => isArtifactLike(l));
        expect(refHasNoise).toBe(false);
      }

      // outcome better than ambiguous for this
      expect(["actionable", "completed"]).toContain(state.outcome);
    } finally {
      await fs.rm(isolatedProject, { recursive: true, force: true });
    }
  });
});
