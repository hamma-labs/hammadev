import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  hookSettingsPath,
  installHooks,
  uninstallHooks,
} from "../../src/core/hooks-install.js";

let projectPath = "";

async function readSettings(target: string): Promise<any> {
  return JSON.parse(await fs.readFile(target, "utf8"));
}

beforeEach(async () => {
  projectPath = await fs.mkdtemp(path.join(os.tmpdir(), "hamma-hooks-install-"));
});

afterEach(async () => {
  if (projectPath) await fs.rm(projectPath, { recursive: true, force: true });
});

describe("installHooks", () => {
  it("creates Claude local settings with sync and bootstrap hooks", async () => {
    const result = await installHooks({ agent: "claude", projectPath });
    expect(result.settingsPath).toBe(
      path.join(projectPath, ".claude", "settings.local.json")
    );
    expect(result.created).toBe(true);
    expect(result.installed.sort()).toEqual(["PreCompact", "SessionEnd", "SessionStart"]);
    expect(result.replaced).toEqual([]);
    expect(result.warnings).toEqual([]);

    const settings = await readSettings(result.settingsPath);
    expect(settings.hooks.PreCompact).toEqual([{
      hooks: [{
        type: "command",
        command: "hamma memory sync --hook-agent claude --no-gitignore",
        timeout: 30,
      }],
    }]);
    expect(settings.hooks.SessionEnd[0].hooks[0].command).toBe(
      "hamma memory sync --hook-agent claude --no-gitignore"
    );
    expect(settings.hooks.SessionStart).toEqual([{
      hooks: [{
        type: "command",
        command: "hamma bootstrap --hook-agent claude",
        timeout: 10,
      }],
    }]);
  });

  it("writes shared Claude settings.json with --shared", async () => {
    const result = await installHooks({ agent: "claude", projectPath, shared: true });
    expect(result.settingsPath).toBe(path.join(projectPath, ".claude", "settings.json"));
  });

  it("creates Codex hooks.json with checkpoint and session-start bootstrap hooks", async () => {
    const result = await installHooks({ agent: "codex", projectPath });
    expect(result.settingsPath).toBe(path.join(projectPath, ".codex", "hooks.json"));
    expect(result.installed.sort()).toEqual(["PreCompact", "SessionStart"]);
    const settings = await readSettings(result.settingsPath);
    expect(settings.hooks.PreCompact[0].hooks[0]).toEqual({
      type: "command",
      command: "hamma memory sync --hook-agent codex --no-gitignore",
      timeout: 30,
      statusMessage: "Checkpointing active Hamma memory",
    });
    expect(settings.hooks.SessionStart).toEqual([{
      hooks: [{
        type: "command",
        command: "hamma bootstrap --hook-agent codex",
        timeout: 10,
      }],
    }]);
    expect(settings.hooks.SessionEnd).toBeUndefined();
  });

  it("creates the Grok owned hook file and adds SessionStart only when requested", async () => {
    const withoutStart = await installHooks({ agent: "grok", projectPath });
    expect(withoutStart.settingsPath).toBe(
      path.join(projectPath, ".grok", "hooks", "hamma-memory.json")
    );
    expect(withoutStart.installed.sort()).toEqual(["PreCompact", "SessionEnd"]);

    const withStart = await installHooks({ agent: "grok", projectPath, sessionStart: true });
    expect(withStart.installed).toEqual(["SessionStart"]);
    expect(withStart.skipped.sort()).toEqual(["PreCompact", "SessionEnd"]);
    const settings = await readSettings(withStart.settingsPath);
    expect(settings.hooks.SessionStart[0].hooks[0].command).toBe(
      "hamma bootstrap --hook-agent grok"
    );
  });

  it("is idempotent: a re-run skips every event and does not rewrite the file", async () => {
    const first = await installHooks({ agent: "claude", projectPath });
    const before = await fs.stat(first.settingsPath);
    const second = await installHooks({ agent: "claude", projectPath });
    expect(second.installed).toEqual([]);
    expect(second.replaced).toEqual([]);
    expect(second.skipped.sort()).toEqual(["PreCompact", "SessionEnd", "SessionStart"]);
    const after = await fs.stat(first.settingsPath);
    expect(after.mtimeMs).toBe(before.mtimeMs);
  });

  it("preserves unrelated settings keys and non-hamma hook groups", async () => {
    const target = hookSettingsPath({ agent: "claude", projectPath });
    await fs.mkdir(path.dirname(target), { recursive: true });
    const userGroup = {
      matcher: "Bash",
      hooks: [{ type: "command", command: "./scripts/lint-check.sh", timeout: 5 }],
    };
    await fs.writeFile(target, `${JSON.stringify({
      permissions: { allow: ["Bash(pnpm test)"] },
      env: { DEBUG: "1" },
      hooks: { PreCompact: [userGroup] },
    }, null, 2)}\n`);

    const result = await installHooks({ agent: "claude", projectPath });
    expect(result.installed.sort()).toEqual(["PreCompact", "SessionEnd", "SessionStart"]);
    const settings = await readSettings(target);
    expect(settings.permissions).toEqual({ allow: ["Bash(pnpm test)"] });
    expect(settings.env).toEqual({ DEBUG: "1" });
    expect(settings.hooks.PreCompact[0]).toEqual(userGroup);
    expect(settings.hooks.PreCompact[1].hooks[0].command).toContain("hamma memory sync");
  });

  it("warns without --force and replaces with --force when a hamma entry differs", async () => {
    await installHooks({ agent: "claude", projectPath });
    const target = hookSettingsPath({ agent: "claude", projectPath });
    const settings = await readSettings(target);
    settings.hooks.SessionStart[0].hooks[0].timeout = 99;
    settings.hooks.SessionStart[0].hooks.push({
      type: "command", command: "./scripts/notify.sh", timeout: 5,
    });
    await fs.writeFile(target, `${JSON.stringify(settings, null, 2)}\n`);

    const withoutForce = await installHooks({ agent: "claude", projectPath });
    expect(withoutForce.replaced).toEqual([]);
    expect(withoutForce.warnings.join(" ")).toContain("SessionStart");
    expect((await readSettings(target)).hooks.SessionStart[0].hooks[0].timeout).toBe(99);

    const withForce = await installHooks({ agent: "claude", projectPath, force: true });
    expect(withForce.replaced).toEqual(["SessionStart"]);
    const updated = await readSettings(target);
    const group = updated.hooks.SessionStart[0];
    expect(group.hooks).toHaveLength(2);
    expect(group.hooks.map((hook: any) => hook.command)).toContain("./scripts/notify.sh");
    const hammaHook = group.hooks.find((hook: any) => hook.command.startsWith("hamma "));
    expect(hammaHook.timeout).toBe(10);
  });

  it("refuses a corrupted settings file even with --force", async () => {
    const target = hookSettingsPath({ agent: "claude", projectPath });
    await fs.mkdir(path.dirname(target), { recursive: true });
    await fs.writeFile(target, "{ not json\n");
    await expect(installHooks({ agent: "claude", projectPath, force: true }))
      .rejects.toThrow(/not valid JSON.*fix or move/s);
    expect(await fs.readFile(target, "utf8")).toBe("{ not json\n");
  });

  it("refuses a symlinked settings file", async () => {
    const target = hookSettingsPath({ agent: "claude", projectPath });
    await fs.mkdir(path.dirname(target), { recursive: true });
    await fs.writeFile(`${target}.real`, "{}\n");
    await fs.symlink(`${target}.real`, target);
    await expect(installHooks({ agent: "claude", projectPath }))
      .rejects.toThrow(/not a safe regular file/);
  });

  it("rejects wrongly-typed hooks keys with the offending key named", async () => {
    const target = hookSettingsPath({ agent: "claude", projectPath });
    await fs.mkdir(path.dirname(target), { recursive: true });
    await fs.writeFile(target, `${JSON.stringify({ hooks: [] }, null, 2)}\n`);
    await expect(installHooks({ agent: "claude", projectPath }))
      .rejects.toThrow(/non-object 'hooks'/);

    await fs.writeFile(target, `${JSON.stringify({ hooks: { PreCompact: {} } }, null, 2)}\n`);
    await expect(installHooks({ agent: "claude", projectPath }))
      .rejects.toThrow(/non-array 'hooks.PreCompact'/);
  });
});

describe("uninstallHooks", () => {
  it("removes only hamma-managed entries and keeps user content", async () => {
    const target = hookSettingsPath({ agent: "claude", projectPath });
    await fs.mkdir(path.dirname(target), { recursive: true });
    const userGroup = {
      hooks: [{ type: "command", command: "./scripts/lint-check.sh", timeout: 5 }],
    };
    await fs.writeFile(target, `${JSON.stringify({
      permissions: { allow: ["Bash(pnpm test)"] },
      hooks: { PreCompact: [userGroup] },
    }, null, 2)}\n`);
    await installHooks({ agent: "claude", projectPath });

    const result = await uninstallHooks({ agent: "claude", projectPath });
    expect(result.removed.sort()).toEqual(["PreCompact", "SessionEnd", "SessionStart"]);
    expect(result.fileDeleted).toBe(false);
    const settings = await readSettings(target);
    expect(settings.permissions).toEqual({ allow: ["Bash(pnpm test)"] });
    expect(settings.hooks.PreCompact).toEqual([userGroup]);
    expect(settings.hooks.SessionEnd).toBeUndefined();
    expect(settings.hooks.SessionStart).toBeUndefined();
  });

  it("removes mixed groups but keeps sibling non-hamma hooks", async () => {
    await installHooks({ agent: "claude", projectPath });
    const target = hookSettingsPath({ agent: "claude", projectPath });
    const settings = await readSettings(target);
    settings.hooks.SessionEnd[0].hooks.push({
      type: "command", command: "./scripts/notify.sh", timeout: 5,
    });
    await fs.writeFile(target, `${JSON.stringify(settings, null, 2)}\n`);

    await uninstallHooks({ agent: "claude", projectPath });
    const updated = await readSettings(target);
    expect(updated.hooks.SessionEnd).toEqual([{
      hooks: [{ type: "command", command: "./scripts/notify.sh", timeout: 5 }],
    }]);
  });

  it("deletes a hooks-only file it fully empties", async () => {
    const install = await installHooks({ agent: "grok", projectPath });
    const result = await uninstallHooks({ agent: "grok", projectPath });
    expect(result.removed.sort()).toEqual(["PreCompact", "SessionEnd"]);
    expect(result.fileDeleted).toBe(true);
    await expect(fs.access(install.settingsPath)).rejects.toThrow();
  });

  it("is a no-op when nothing is installed", async () => {
    const result = await uninstallHooks({ agent: "claude", projectPath });
    expect(result.removed).toEqual([]);
    expect(result.fileDeleted).toBe(false);
  });
});
