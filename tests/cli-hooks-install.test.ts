import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const execFileAsync = promisify(execFile);
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const CLI = path.join(ROOT, "src", "cli.ts");
const TSX = path.join(ROOT, "node_modules", ".bin", "tsx");

let fixtureRoot = "";
let projectPath = "";

async function run(args: string[]): Promise<string> {
  const result = await execFileAsync(TSX, [CLI, ...args], { cwd: ROOT });
  return result.stdout;
}

beforeAll(async () => {
  fixtureRoot = await fs.mkdtemp(path.join(os.tmpdir(), "hamma-cli-hooks-"));
  projectPath = path.join(fixtureRoot, "project");
  await fs.mkdir(projectPath, { recursive: true });
});

afterAll(async () => {
  if (fixtureRoot) await fs.rm(fixtureRoot, { recursive: true, force: true });
});

describe("hooks install CLI command", () => {
  it("installs Claude hooks into settings.local.json and emits JSON", async () => {
    const result = JSON.parse(await run([
      "hooks", "install", "--agent", "claude", "--project", projectPath, "--json",
    ]));
    expect(result).toMatchObject({
      schemaVersion: 1,
      agent: "claude",
      created: true,
      replaced: [],
      warnings: [],
    });
    expect(result.installed.sort()).toEqual(["PreCompact", "SessionEnd", "SessionStart"]);
    expect(result.settingsPath).toBe(
      path.join(projectPath, ".claude", "settings.local.json")
    );
    const settings = JSON.parse(await fs.readFile(result.settingsPath, "utf8"));
    expect(settings.hooks.SessionStart[0].hooks[0].command).toBe(
      "hamma bootstrap --hook-agent claude"
    );
    expect(settings.hooks.PreCompact[0].hooks[0].command).toBe(
      "hamma memory sync --hook-agent claude --no-gitignore"
    );
  });

  it("is idempotent on re-run without --force", async () => {
    const result = JSON.parse(await run([
      "hooks", "install", "--agent", "claude", "--project", projectPath, "--json",
    ]));
    expect(result.installed).toEqual([]);
    expect(result.skipped.sort()).toEqual(["PreCompact", "SessionEnd", "SessionStart"]);
  });

  it("writes shared settings.json with --shared", async () => {
    const result = JSON.parse(await run([
      "hooks", "install", "--agent", "claude", "--project", projectPath, "--shared", "--json",
    ]));
    expect(result.settingsPath).toBe(path.join(projectPath, ".claude", "settings.json"));
  });

  it("installs native Codex checkpoint and session-start hooks", async () => {
    const codexProject = path.join(fixtureRoot, "codex-project");
    await fs.mkdir(codexProject, { recursive: true });
    const result = JSON.parse(await run([
      "hooks", "install", "--agent", "codex", "--project", codexProject, "--json",
    ]));
    expect(result.installed.sort()).toEqual(["PreCompact", "SessionStart"]);
    const settings = JSON.parse(await fs.readFile(result.settingsPath, "utf8"));
    expect(settings.hooks.PreCompact[0].hooks[0].command).toBe(
      "hamma memory sync --hook-agent codex --no-gitignore"
    );
    expect(settings.hooks.SessionStart[0].hooks[0].command).toBe(
      "hamma bootstrap --hook-agent codex"
    );
    expect(settings.hooks.SessionEnd).toBeUndefined();
  });

  it("installs all three agents with --agent all", async () => {
    const allProject = path.join(fixtureRoot, "all-project");
    await fs.mkdir(allProject, { recursive: true });
    const result = JSON.parse(await run([
      "hooks", "install", "--agent", "all", "--project", allProject, "--json",
    ]));
    const agents = result.installs.map((entry: { agent: string }) => entry.agent).sort();
    expect(agents).toEqual(["claude", "codex", "grok"]);
    await fs.access(path.join(allProject, ".claude", "settings.local.json"));
    const codexSettings = JSON.parse(await fs.readFile(
      path.join(allProject, ".codex", "hooks.json"),
      "utf8"
    ));
    expect(codexSettings.hooks.SessionStart[0].hooks[0].command).toBe(
      "hamma bootstrap --hook-agent codex"
    );
    await fs.access(path.join(allProject, ".grok", "hooks", "hamma-memory.json"));
  });

  it("installs the Grok SessionStart hook by default and honors --no-session-start", async () => {
    const grokProject = path.join(fixtureRoot, "grok-project");
    await fs.mkdir(grokProject, { recursive: true });
    const withStart = JSON.parse(await run([
      "hooks", "install", "--agent", "grok", "--project", grokProject, "--json",
    ]));
    expect(withStart.installed.sort()).toEqual(["PreCompact", "SessionEnd", "SessionStart"]);
    const settings = JSON.parse(await fs.readFile(withStart.settingsPath, "utf8"));
    expect(settings.hooks.SessionStart[0].hooks[0].command).toBe(
      "hamma bootstrap --hook-agent grok"
    );

    const optOutProject = path.join(fixtureRoot, "grok-no-start-project");
    await fs.mkdir(optOutProject, { recursive: true });
    const withoutStart = JSON.parse(await run([
      "hooks", "install", "--agent", "grok", "--project", optOutProject,
      "--no-session-start", "--json",
    ]));
    expect(withoutStart.installed.sort()).toEqual(["PreCompact", "SessionEnd"]);
  });

  it("prints the bootstrap-mode hint after a non-JSON install", async () => {
    const hintProject = path.join(fixtureRoot, "hint-project");
    await fs.mkdir(hintProject, { recursive: true });
    const stdout = await run([
      "hooks", "install", "--agent", "grok", "--project", hintProject,
    ]);
    expect(stdout).toContain("Session-start memory loading is 'manual'");
    expect(stdout).toContain("hamma config set bootstrap automatic");
    expect(stdout).toContain("For reliable Grok exit checkpoints, launch with `hamma grok`.");
  });

  it("fails with INSTALL_ERROR on a corrupted settings file", async () => {
    const corruptProject = path.join(fixtureRoot, "corrupt-project");
    const target = path.join(corruptProject, ".claude", "settings.local.json");
    await fs.mkdir(path.dirname(target), { recursive: true });
    await fs.writeFile(target, "{ not json\n");
    await expect(run([
      "hooks", "install", "--agent", "claude", "--project", corruptProject, "--json",
    ])).rejects.toThrow(/INSTALL_ERROR/);
    expect(await fs.readFile(target, "utf8")).toBe("{ not json\n");
  });

  it("rejects an unsupported agent", async () => {
    await expect(run([
      "hooks", "install", "--agent", "cursor", "--project", projectPath, "--json",
    ])).rejects.toThrow(/INSTALL_ERROR/);
  });

  it("uninstall removes hamma entries and preserves user settings", async () => {
    const roundTrip = path.join(fixtureRoot, "roundtrip-project");
    const target = path.join(roundTrip, ".claude", "settings.local.json");
    await fs.mkdir(path.dirname(target), { recursive: true });
    const userContent = {
      permissions: { allow: ["Bash(pnpm test)"] },
      hooks: {
        PreCompact: [{ hooks: [{ type: "command", command: "./scripts/user.sh", timeout: 5 }] }],
      },
    };
    await fs.writeFile(target, `${JSON.stringify(userContent, null, 2)}\n`);

    await run(["hooks", "install", "--agent", "claude", "--project", roundTrip, "--json"]);
    const result = JSON.parse(await run([
      "hooks", "uninstall", "--agent", "claude", "--project", roundTrip, "--json",
    ]));
    expect(result.removed.sort()).toEqual(["PreCompact", "SessionEnd", "SessionStart"]);
    expect(result.fileDeleted).toBe(false);
    const settings = JSON.parse(await fs.readFile(target, "utf8"));
    expect(settings).toEqual(userContent);
  });

  it("detects installed agents when --agent is omitted", async () => {
    const detectProject = path.join(fixtureRoot, "detect-project");
    const binDir = path.join(fixtureRoot, "bin");
    await fs.mkdir(detectProject, { recursive: true });
    await fs.mkdir(binDir, { recursive: true });
    // The controlled PATH must still expose node for the tsx shebang.
    await fs.symlink(process.execPath, path.join(binDir, "node"));
    const fakeClaude = path.join(binDir, "claude");
    await fs.writeFile(fakeClaude, "#!/bin/sh\necho fake-claude 1.0.0\n");
    await fs.chmod(fakeClaude, 0o755);

    const result = await execFileAsync(
      TSX,
      [CLI, "hooks", "install", "--project", detectProject, "--json"],
      { cwd: ROOT, env: { ...process.env, PATH: `${binDir}:/usr/bin:/bin` } }
    );
    const output = JSON.parse(result.stdout);
    expect(output.agent).toBe("claude");
    await fs.access(path.join(detectProject, ".claude", "settings.local.json"));
    await expect(fs.access(path.join(detectProject, ".codex"))).rejects.toThrow();
  });

  it("errors when no agent is installed and --agent is omitted", async () => {
    const emptyBin = path.join(fixtureRoot, "empty-bin");
    await fs.mkdir(emptyBin, { recursive: true });
    await fs.symlink(process.execPath, path.join(emptyBin, "node"));
    const noneProject = path.join(fixtureRoot, "none-project");
    await fs.mkdir(noneProject, { recursive: true });
    await expect(execFileAsync(
      TSX,
      [CLI, "hooks", "install", "--project", noneProject, "--json"],
      { cwd: ROOT, env: { ...process.env, PATH: `${emptyBin}:/usr/bin:/bin` } }
    )).rejects.toThrow(/No supported coding agent/);
  });
});
