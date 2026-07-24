import { Readable, Writable } from "node:stream";
import { createInterface, Interface } from "node:readline/promises";
import path from "node:path";
import pc from "picocolors";
import { launchClaudeWithRecovery } from "../adapters/claude/runtime.js";
import { launchCodexWithRecovery } from "../adapters/codex/runtime.js";
import { launchGrokWithRecovery } from "../adapters/grok/runtime.js";
import { SupportedSourceCli } from "../session-loader.js";
import { AgentLauncherOptions, AgentLauncherResult } from "./agent-launch.js";
import { startMemory } from "./memory.js";
import { getProjectStatus, ProjectStatus } from "./project-status.js";
import { commandAvailable } from "./quickstart.js";
import {
  detectSimpleSource,
  SimpleSwitchResult,
  simpleSwitch,
} from "./simple-ux.js";
import { runSetup, SetupResult } from "./setup.js";

const HOME_AGENTS = ["codex", "claude", "grok"] as const;

export type HammaHomeAgent = typeof HOME_AGENTS[number];

export interface HammaHomeChoice {
  value: HammaHomeAgent;
  label: string;
  recommended: boolean;
}

export interface HammaHomePrompt {
  confirm(message: string): Promise<boolean>;
  select(message: string, choices: HammaHomeChoice[]): Promise<HammaHomeAgent | undefined>;
  write(message: string): void;
  releaseInput(): void;
}

export interface HammaHomeDependencies {
  getStatus(projectPath: string): Promise<ProjectStatus>;
  availability(agent: HammaHomeAgent): Promise<boolean>;
  checkSetup(projectPath: string, availability: Record<HammaHomeAgent, boolean>): Promise<SetupResult>;
  applySetup(projectPath: string, availability: Record<HammaHomeAgent, boolean>): Promise<SetupResult>;
  startDefaultMemory(projectPath: string): Promise<void>;
  detectSource(projectPath: string): Promise<SupportedSourceCli | undefined>;
  switchAgent(projectPath: string, target: HammaHomeAgent): Promise<SimpleSwitchResult>;
  launchAgent(agent: HammaHomeAgent, options: AgentLauncherOptions): Promise<AgentLauncherResult>;
}

export interface HammaHomeResult {
  status: "cancelled" | "completed";
  target?: HammaHomeAgent;
  setupApplied: boolean;
  switched: boolean;
  launcher?: AgentLauncherResult;
}

function label(agent: HammaHomeAgent): string {
  if (agent === "codex") return "Codex";
  if (agent === "claude") return "Claude";
  return "Grok";
}

function defaultDependencies(): HammaHomeDependencies {
  return {
    getStatus: getProjectStatus,
    availability: commandAvailable,
    checkSetup: (projectPath, availability) => runSetup(projectPath, {
      bootstrapMode: "automatic",
      availability,
    }),
    applySetup: (projectPath, availability) => runSetup(projectPath, {
      bootstrapMode: "automatic",
      availability,
      apply: true,
    }),
    startDefaultMemory: async (projectPath) => {
      await startMemory(projectPath, "default");
    },
    detectSource: async (projectPath) => {
      try {
        return (await detectSimpleSource(projectPath, { allowMissing: true }))?.agent;
      } catch {
        return undefined;
      }
    },
    switchAgent: (projectPath, target) => simpleSwitch(projectPath, target),
    launchAgent: async (agent, options) => {
      if (agent === "codex") return launchCodexWithRecovery(options);
      if (agent === "claude") return launchClaudeWithRecovery(options);
      return launchGrokWithRecovery(options);
    },
  };
}

function setupConflict(result: SetupResult): string | undefined {
  const hookWarning = result.hooks.flatMap((hook) => hook.warnings)[0];
  if (hookWarning) return hookWarning;
  if (!result.environment.node.ok) {
    return `Node.js ${result.environment.node.minimum}+ is required; detected ${result.environment.node.version}.`;
  }
  if (!result.environment.git.ok) return "Git is not installed or is not on PATH.";
  if (!result.environment.gitRepository) return "Run Hamma from inside a Git project.";
  if (result.selectedAgents.length === 0) {
    return "Install Codex, Claude Code, or Grok, then run `hamma` again.";
  }
  return undefined;
}

function setupSummary(result: SetupResult): string {
  const names = result.selectedAgents.map((agent) => label(agent)).join(", ");
  return [
    `Set up Hamma for ${names}?`,
    "  • Lifecycle hooks: auto-save before context compaction and on session end",
    "  • Session-start context: load project memory when an agent starts",
    "  • .gitignore: keep .hamma/ out of version control",
    "[y/N] ",
  ].join("\n");
}

function hasProjectSession(status: ProjectStatus): boolean {
  return status.codexProjectSessionCount > 0 ||
    status.claudeProjectSessionCount > 0 ||
    status.grokProjectSessionCount > 0;
}

function launcherOptions(
  projectPath: string,
  memory: string,
  switched?: SimpleSwitchResult
): AgentLauncherOptions {
  return {
    projectPath,
    memory,
    command: switched?.attach.launch.command,
    args: [],
    attachId: switched?.attach.attachId,
  };
}

export async function runHammaHome(
  projectDirectory: string,
  prompt: HammaHomePrompt,
  injected: Partial<HammaHomeDependencies> = {}
): Promise<HammaHomeResult> {
  const projectPath = path.resolve(projectDirectory);
  const dependencies = { ...defaultDependencies(), ...injected };
  const status = await dependencies.getStatus(projectPath);
  if (status.gitStatus === "unavailable") {
    throw new Error(
      "Git is not installed. Hamma needs Git to track your project.\n" +
      "  Install it: https://git-scm.com/downloads\n" +
      "  Then come back and run `hamma` again."
    );
  }
  if (!status.isGitRepo) {
    throw new Error(
      "This folder isn't a Git project yet.\n" +
      "  To set it up: git init\n" +
      "  Then run `hamma` again."
    );
  }

  const availabilityEntries = await Promise.all(HOME_AGENTS.map(async (agent) => [
    agent,
    await dependencies.availability(agent),
  ] as const));
  const availability = Object.fromEntries(availabilityEntries) as Record<HammaHomeAgent, boolean>;
  const installed = HOME_AGENTS.filter((agent) => availability[agent]);
  if (installed.length === 0) {
    throw new Error(
      "No AI coding agents found on this machine.\n\n" +
      "  Install one (pick any):\n" +
      "  • Codex:  npm install -g @openai/codex\n" +
      "  • Claude: npm install -g @anthropic-ai/claude-code\n" +
      "  • Grok:   npm install -g grok-cli\n\n" +
      "  Then run `hamma` again."
    );
  }

  const currentSource = status.memory.openAttachTarget as HammaHomeAgent | undefined ??
    await dependencies.detectSource(projectPath);
  const recommended = installed.find((agent) => agent !== currentSource) ?? installed[0];
  const choices = installed.map((agent) => ({
    value: agent,
    label: label(agent),
    recommended: agent === recommended,
  }));

  prompt.write(`${pc.bold("Hamma")}\n${pc.dim(projectPath)}\n\n`);
  const target = installed.length === 1
    ? installed[0]
    : await prompt.select("Where do you want to continue?", choices);
  if (!target) {
    prompt.write("Cancelled. No changes were made.\n");
    return { status: "cancelled", setupApplied: false, switched: false };
  }

  const checked = await dependencies.checkSetup(projectPath, availability);
  const conflict = setupConflict(checked);
  if (conflict) {
    throw new Error(`${conflict}\n  Run \`hamma doctor\` to diagnose the problem.`);
  }

  let setupApplied = false;
  if (checked.changesRequired) {
    if (!await prompt.confirm(setupSummary(checked))) {
      prompt.write("Cancelled. No changes were made.\n");
      return { status: "cancelled", target, setupApplied: false, switched: false };
    }
    const applied = await dependencies.applySetup(projectPath, availability);
    if (!applied.ready) {
      throw new Error("Setup could not be verified. Run `hamma setup --check` for details.");
    }
    setupApplied = true;
    prompt.write(`${pc.green("✓")} Hamma is ready\n`);
  }

  let memory = status.memory.activeName;
  if (!memory) {
    await dependencies.startDefaultMemory(projectPath);
    memory = "default";
  }

  let switched: SimpleSwitchResult | undefined;
  if (status.memory.revisionCount > 0 || status.memory.openAttachId || hasProjectSession(status)) {
    try {
      switched = await dependencies.switchAgent(projectPath, target);
    } catch (switchError: unknown) {
      const msg = switchError instanceof Error ? switchError.message : String(switchError);
      prompt.write(`\n${pc.yellow("!")} Hamma ran into a hiccup: ${msg}\n`);
      prompt.write(pc.dim("  This usually happens after an interrupted session.\n"));
      prompt.write(`\n  Opening ${label(target)} without saved context instead.\n\n`);
      // Continue without switch — launch the agent fresh
    }
  }

  prompt.write(`${pc.cyan("Opening")} ${label(target)}…\n`);
  // The launched agent inherits this terminal. Release readline before spawn
  // so Hamma cannot consume keystrokes intended for the child process.
  prompt.releaseInput();
  const launcher = await dependencies.launchAgent(
    target,
    launcherOptions(projectPath, switched?.memory ?? memory, switched)
  );
  if (launcher.checkpoint?.status === "updated") {
    prompt.write(`${pc.green("✓")} Work saved\n`);
  } else if (launcher.checkpoint?.status === "unchanged") {
    prompt.write(`${pc.green("✓")} Work is current\n`);
  } else if (launcher.setupWarning || launcher.checkpoint?.status === "pending" || launcher.checkpoint?.status === "failed") {
    prompt.write(`${pc.yellow("!")} Hamma could not verify the final save. Run \`hamma quickstart\` for details.\n`);
  }
  return {
    status: "completed",
    target,
    setupApplied,
    switched: Boolean(switched),
    launcher,
  };
}

export class TerminalHammaPrompt implements HammaHomePrompt {
  private readline: Interface;
  private readonly input: Readable;
  private inputReleased = false;

  constructor(
    input: Readable = process.stdin,
    private readonly output: Writable = process.stdout
  ) {
    this.input = input;
    this.readline = createInterface({ input, output });
  }

  write(message: string): void {
    this.output.write(message);
  }

  async confirm(message: string): Promise<boolean> {
    if (this.supportsRawMode()) {
      return this.confirmRawMode(message);
    }
    const response = (await this.readline.question(message)).trim().toLowerCase();
    return response === "y" || response === "yes";
  }

  private supportsRawMode(): boolean {
    const stream = this.input as any;
    return Boolean(stream.isTTY && typeof stream.setRawMode === "function");
  }

  private confirmRawMode(message: string): Promise<boolean> {
    const stream = this.input as any;
    // Close readline so it doesn't compete for stdin data events.
    this.readline.close();
    return new Promise((resolve) => {
      this.write(message);
      stream.setRawMode(true);
      stream.resume();

      const onData = (buf: Buffer): void => {
        const key = buf.toString().toLowerCase();
        if (key === "y") {
          cleanup();
          stream.setRawMode(false);
          this.write("y\n");
          this.readline = createInterface({ input: this.input, output: this.output });
          resolve(true);
        } else if (key === "n" || key === "\r" || key === "\n" || key === "\x03") {
          cleanup();
          stream.setRawMode(false);
          this.write("n\n");
          this.readline = createInterface({ input: this.input, output: this.output });
          resolve(false);
        }
        // Ignore other keys — wait for y/n/enter
      };

      const cleanup = (): void => {
        stream.removeListener("data", onData);
      };
      stream.on("data", onData);
    });
  }

  private selectRawMode(choices: HammaHomeChoice[], defaultIndex: number): Promise<HammaHomeAgent | undefined> {
    const stream = this.input as any;
    // Close readline so it doesn't compete for stdin data events.
    this.readline.close();
    return new Promise((resolve) => {
      this.write(`Press 1–${choices.length} or Enter for default: `);
      stream.setRawMode(true);
      stream.resume();

      const finish = (value: HammaHomeAgent | undefined, echo: string): void => {
        cleanup();
        stream.setRawMode(false);
        this.write(`${echo}\n`);
        // Recreate readline for any subsequent prompts.
        this.readline = createInterface({ input: this.input, output: this.output });
        resolve(value);
      };

      const onData = (buf: Buffer): void => {
        const key = buf.toString();
        // Ctrl-C
        if (key === "\x03") {
          finish(undefined, "");
          return;
        }
        // Enter — select default
        if (key === "\r" || key === "\n") {
          finish(choices[defaultIndex]?.value, String(defaultIndex + 1));
          return;
        }
        // q — cancel
        if (key === "q" || key === "Q") {
          finish(undefined, "q");
          return;
        }
        // Number keys
        const num = Number(key);
        if (Number.isInteger(num) && num >= 1 && num <= choices.length) {
          finish(choices[num - 1].value, String(num));
          return;
        }
        // Unrecognized key — show help
        this.write(`\n  Press 1–${choices.length}, Enter for default, or q to cancel: `);
      };

      const cleanup = (): void => {
        stream.removeListener("data", onData);
      };
      stream.on("data", onData);
    });
  }

  async select(message: string, choices: HammaHomeChoice[]): Promise<HammaHomeAgent | undefined> {
    this.write(`${message}\n`);
    choices.forEach((choice, index) => {
      this.write(`  ${index + 1}. ${choice.label}${choice.recommended ? " (recommended)" : ""}\n`);
    });
    const defaultIndex = choices.findIndex((choice) => choice.recommended);

    if (this.supportsRawMode()) {
      return this.selectRawMode(choices, defaultIndex);
    }

    // Fallback: readline-based selection for non-TTY (piped input, tests)
    while (true) {
      const response = (await this.readline.question(`Choose [${defaultIndex + 1}]: `)).trim();
      if (!response) return choices[defaultIndex]?.value;
      if (/^(?:q|quit|cancel)$/i.test(response)) return undefined;
      const selected = Number(response);
      if (Number.isInteger(selected) && selected >= 1 && selected <= choices.length) {
        return choices[selected - 1].value;
      }
      this.write(`Choose a number from 1 to ${choices.length}, or q to cancel.\n`);
    }
  }

  releaseInput(): void {
    if (this.inputReleased) return;
    this.inputReleased = true;
    this.readline.close();
  }

  close(): void {
    this.releaseInput();
  }
}

export async function runTerminalHammaHome(projectPath: string): Promise<HammaHomeResult> {
  const prompt = new TerminalHammaPrompt();
  try {
    return await runHammaHome(projectPath, prompt);
  } finally {
    prompt.close();
  }
}
