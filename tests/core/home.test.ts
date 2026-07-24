import { describe, expect, it, vi } from "vitest";
import { PassThrough } from "node:stream";
import {
  HammaHomeChoice,
  HammaHomeDependencies,
  HammaHomePrompt,
  runHammaHome,
  TerminalHammaPrompt,
} from "../../src/core/home.js";
import { ProjectStatus } from "../../src/core/project-status.js";
import { SetupResult } from "../../src/core/setup.js";

function status(overrides: Partial<ProjectStatus> = {}): ProjectStatus {
  return {
    projectPath: "/project",
    isGitRepo: true,
    gitStatus: "clean",
    handoffCount: 0,
    codexSessionCount: 0,
    claudeSessionCount: 0,
    grokSessionCount: 0,
    codexProjectSessionCount: 0,
    claudeProjectSessionCount: 0,
    grokProjectSessionCount: 0,
    hammaIgnored: false,
    memory: { count: 0, revisionCount: 0 },
    ...overrides,
  };
}

function setup(overrides: Partial<SetupResult> = {}): SetupResult {
  return {
    schemaVersion: 1,
    mode: "check",
    projectPath: "/project",
    environment: {
      node: { ok: true, version: "24.0.0", minimum: "22.12.0" },
      git: { ok: true, version: "git version 2" },
      gitRepository: true,
      hammaIgnored: false,
      agents: [
        { agent: "claude", installed: true },
        { agent: "codex", installed: true },
        { agent: "grok", installed: false },
      ],
    },
    selectedAgents: ["claude", "codex"],
    bootstrap: { previous: "manual", requested: "automatic", changed: true, applied: false },
    hooks: [],
    verification: [],
    changesRequired: true,
    changesApplied: false,
    consentRequired: true,
    ready: false,
    warnings: [],
    nextCommand: "hamma setup --apply --agent claude,codex --bootstrap automatic",
    ...overrides,
  };
}

function prompt(options: { confirm?: boolean; select?: "codex" | "claude" | "grok" } = {}) {
  const output: string[] = [];
  const value = {
    output,
    write: (message) => output.push(message),
    confirm: vi.fn(async () => options.confirm ?? true),
    select: vi.fn(async (_message: string, choices: HammaHomeChoice[]) =>
      options.select ?? choices.find((choice) => choice.recommended)?.value),
    releaseInput: vi.fn((): void => undefined),
  } satisfies HammaHomePrompt & { output: string[] };
  return value;
}

function dependencies(overrides: Partial<HammaHomeDependencies> = {}): HammaHomeDependencies {
  return {
    getStatus: vi.fn(async () => status()),
    availability: vi.fn(async (agent) => agent !== "grok"),
    checkSetup: vi.fn(async () => setup()),
    applySetup: vi.fn(async () => setup({
      mode: "apply",
      ready: true,
      changesRequired: false,
      changesApplied: true,
    })),
    startDefaultMemory: vi.fn(async () => undefined),
    detectSource: vi.fn(async () => "codex" as const),
    switchAgent: vi.fn(async () => ({
      schemaVersion: 1,
      operation: "switch",
      memory: "default",
      target: "claude",
      saved: true,
      transferredClaim: false,
      attach: {
        memory: "default",
        attachId: "123e4567-e89b-4def-8123-456789abcdef",
        launch: { command: "claude", args: ["internal prompt"] },
      },
    } as never)),
    launchAgent: vi.fn(async () => ({
      exitCode: 0,
      recoveryEnabled: true,
      checkpoint: {
        status: "updated" as const,
        agent: "claude" as const,
        launchId: "launch",
        memory: "default",
      },
    })),
    ...overrides,
  };
}

describe("one-command Hamma home", () => {
  it("re-prompts invalid numbered input and accepts cancellation", async () => {
    const input = new PassThrough();
    const output = new PassThrough();
    let written = "";
    output.setEncoding("utf8").on("data", (chunk) => { written += chunk; });
    const terminal = new TerminalHammaPrompt(input, output);
    try {
      const selected = terminal.select("Choose", [
        { value: "codex", label: "Codex", recommended: true },
        { value: "claude", label: "Claude", recommended: false },
      ]);
      input.write("wrong\n");
      await vi.waitFor(() => expect(written).toContain("Choose a number from 1 to 2"));
      input.write("2\n");
      await expect(selected).resolves.toBe("claude");

      const cancelled = terminal.select("Choose again", [
        { value: "codex", label: "Codex", recommended: true },
      ]);
      input.write("q\n");
      await expect(cancelled).resolves.toBeUndefined();
    } finally {
      terminal.close();
    }
  });

  it("releases terminal input idempotently", () => {
    const input = new PassThrough();
    const output = new PassThrough();
    const terminal = new TerminalHammaPrompt(input, output);

    expect(input.listenerCount("data")).toBeGreaterThan(0);
    terminal.releaseInput();
    expect(input.listenerCount("data")).toBe(0);
    expect(() => terminal.releaseInput()).not.toThrow();
    expect(() => terminal.close()).not.toThrow();
  });

  it("asks once, applies setup, initializes memory, and opens the recommended alternate agent", async () => {
    const ui = prompt();
    const deps = dependencies({
      getStatus: vi.fn(async () => status({ codexProjectSessionCount: 1 })),
    });

    const result = await runHammaHome("/project", ui, deps);

    expect(result).toMatchObject({
      status: "completed",
      target: "claude",
      setupApplied: true,
      switched: true,
    });
    expect(ui.select).toHaveBeenCalledWith(
      "Where do you want to continue?",
      expect.arrayContaining([
        expect.objectContaining({ value: "claude", recommended: true }),
      ])
    );
    expect(deps.applySetup).toHaveBeenCalledOnce();
    expect(deps.startDefaultMemory).toHaveBeenCalledOnce();
    expect(deps.switchAgent).toHaveBeenCalledWith("/project", "claude");
    expect(deps.launchAgent).toHaveBeenCalledWith("claude", expect.objectContaining({
      args: [],
      attachId: "123e4567-e89b-4def-8123-456789abcdef",
    }));
    expect(ui.releaseInput).toHaveBeenCalledOnce();
    expect(ui.releaseInput.mock.invocationCallOrder[0]).toBeLessThan(
      vi.mocked(deps.launchAgent).mock.invocationCallOrder[0]
    );
    expect(ui.output.join("")).toContain("Opening");
    expect(ui.output.join("")).toContain("Work saved");
  });

  it("makes no changes when setup consent is declined", async () => {
    const ui = prompt({ confirm: false });
    const deps = dependencies();

    const result = await runHammaHome("/project", ui, deps);

    expect(result.status).toBe("cancelled");
    expect(deps.applySetup).not.toHaveBeenCalled();
    expect(deps.startDefaultMemory).not.toHaveBeenCalled();
    expect(deps.launchAgent).not.toHaveBeenCalled();
    expect(ui.releaseInput).not.toHaveBeenCalled();
    expect(ui.output.join("")).toContain("No changes were made");
  });

  it("skips the picker and starts the first managed session when one agent is installed", async () => {
    const ui = prompt();
    const deps = dependencies({
      availability: vi.fn(async (agent) => agent === "codex"),
      checkSetup: vi.fn(async () => setup({
        selectedAgents: ["codex"],
        changesRequired: false,
        ready: true,
        bootstrap: { previous: "automatic", requested: "automatic", changed: false, applied: false },
      })),
    });

    const result = await runHammaHome("/project", ui, deps);

    expect(result).toMatchObject({ target: "codex", switched: false });
    expect(ui.select).not.toHaveBeenCalled();
    expect(deps.startDefaultMemory).toHaveBeenCalledOnce();
    expect(deps.switchAgent).not.toHaveBeenCalled();
    expect(deps.launchAgent).toHaveBeenCalledWith("codex", expect.objectContaining({
      memory: "default",
      args: [],
    }));
  });

  it("fails concisely before prompting outside a Git repository", async () => {
    const ui = prompt();
    const deps = dependencies({
      getStatus: vi.fn(async () => status({ isGitRepo: false, gitStatus: "not-a-repository" })),
    });

    await expect(runHammaHome("/project", ui, deps)).rejects.toThrow(
      "This folder isn't a Git project yet"
    );
    expect(ui.select).not.toHaveBeenCalled();
    expect(deps.applySetup).not.toHaveBeenCalled();
  });

  it("does not overwrite conflicting managed hooks", async () => {
    const ui = prompt();
    const deps = dependencies({
      checkSetup: vi.fn(async () => setup({
        hooks: [{
          schemaVersion: 1,
          agent: "codex",
          settingsPath: "/project/.codex/hooks.json",
          created: false,
          dryRun: true,
          wouldCreate: false,
          installed: [],
          replaced: [],
          skipped: [],
          warnings: ["Existing Hamma hook differs."],
        }],
      })),
    });

    await expect(runHammaHome("/project", ui, deps)).rejects.toThrow(
      /Existing Hamma hook differs[\s\S]*hamma doctor/
    );
    expect(deps.applySetup).not.toHaveBeenCalled();
  });
});
