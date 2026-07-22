import { execFileSync } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { runSetup } from "../../src/core/setup.js";

let fixtureRoot = "";
let projectPath = "";

beforeEach(async () => {
  fixtureRoot = await fs.mkdtemp(path.join(os.tmpdir(), "hamma-setup-"));
  projectPath = path.join(fixtureRoot, "project with spaces");
  await fs.mkdir(projectPath, { recursive: true });
  execFileSync("git", ["init", "--quiet"], { cwd: projectPath });
});

afterEach(async () => {
  if (fixtureRoot) await fs.rm(fixtureRoot, { recursive: true, force: true });
});

describe("guided setup", () => {
  it("previews every mutation without creating project files", async () => {
    const result = await runSetup(projectPath, {
      agents: ["claude", "codex", "grok"],
      bootstrapMode: "automatic",
      availability: { claude: true, codex: true, grok: true },
    });
    expect(result).toMatchObject({
      mode: "check",
      selectedAgents: ["claude", "codex", "grok"],
      changesRequired: true,
      consentRequired: true,
      ready: false,
      bootstrap: { previous: "manual", requested: "automatic", changed: true, applied: false },
    });
    expect(result.hooks.every((hook) => hook.dryRun && hook.wouldCreate)).toBe(true);
    await expect(fs.access(path.join(projectPath, ".hamma"))).rejects.toThrow();
    await expect(fs.access(path.join(projectPath, ".claude"))).rejects.toThrow();
    await expect(fs.access(path.join(projectPath, ".codex"))).rejects.toThrow();
    await expect(fs.access(path.join(projectPath, ".grok"))).rejects.toThrow();
  });

  it("applies, verifies, and becomes idempotently ready", async () => {
    const availability = { claude: true, codex: true, grok: true };
    const agents = ["claude", "codex", "grok"] as const;
    const applied = await runSetup(projectPath, {
      agents: [...agents],
      bootstrapMode: "automatic",
      availability,
      apply: true,
    });
    expect(applied).toMatchObject({
      mode: "apply",
      ready: true,
      changesRequired: false,
      changesApplied: true,
      bootstrap: { requested: "automatic", applied: true },
      environment: { hammaIgnored: true },
    });
    expect(applied.verification.every((entry) => entry.verified)).toBe(true);
    await fs.access(path.join(projectPath, ".claude", "settings.local.json"));
    await fs.access(path.join(projectPath, ".codex", "hooks.json"));
    await fs.access(path.join(projectPath, ".grok", "hooks", "hamma-memory.json"));
    expect(await fs.readFile(path.join(projectPath, ".gitignore"), "utf8")).toContain(".hamma/");

    const checked = await runSetup(projectPath, {
      agents: [...agents],
      bootstrapMode: "automatic",
      availability,
    });
    expect(checked).toMatchObject({
      mode: "check",
      changesRequired: false,
      consentRequired: false,
      ready: true,
    });
    expect(checked.hooks.every((hook) => hook.installed.length === 0)).toBe(true);
  });

  it("reports a selected agent that is not installed", async () => {
    const result = await runSetup(projectPath, {
      agents: ["codex"],
      availability: { claude: false, codex: false, grok: false },
    });
    expect(result.ready).toBe(false);
    expect(result.warnings.join(" ")).toContain("codex");
  });

  it("does not suggest an apply command with an empty detected-agent value", async () => {
    const result = await runSetup(projectPath, {
      availability: { claude: false, codex: false, grok: false },
    });

    expect(result.selectedAgents).toEqual([]);
    expect(result.nextCommand).toBeUndefined();
    expect(result.warnings.join(" ")).toContain("No supported agent");
  });

  it("validates every selected hook file before applying any changes", async () => {
    const invalidGrokSettings = path.join(
      projectPath,
      ".grok",
      "hooks",
      "hamma-memory.json"
    );
    await fs.mkdir(path.dirname(invalidGrokSettings), { recursive: true });
    await fs.writeFile(invalidGrokSettings, "{not-json", "utf8");

    await expect(runSetup(projectPath, {
      agents: ["claude", "codex", "grok"],
      availability: { claude: true, codex: true, grok: true },
      apply: true,
    })).rejects.toThrow(/not valid JSON/);

    await expect(fs.access(path.join(projectPath, ".claude"))).rejects.toThrow();
    await expect(fs.access(path.join(projectPath, ".codex"))).rejects.toThrow();
  });
});
