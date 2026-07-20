#!/usr/bin/env node
import fs from "node:fs";
import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Command } from "commander";
import pc from "picocolors";
import { CodexAdapter } from "./adapters/codex/index.js";
import { ClaudeAdapter } from "./adapters/claude/index.js";
import { GrokAdapter } from "./adapters/grok/index.js";
import { ClaudeShapeReport } from "./adapters/claude/shape.js";
import { HammaSession } from "./core/schema.js";
import { createHandoff } from "./core/handoff.js";
import {
  formatHandoffLog,
  listHandoffs,
  readHandoff,
  readHandoffRecord,
} from "./core/history.js";
import { formatProjectStatus, getProjectStatus } from "./core/project-status.js";
import { runDoctor } from "./core/doctor.js";
import { installAllSkills, SkillAgent, SkillInstallResult } from "./core/skill-install.js";
import { loadSession, resolveSessionTarget } from "./session-loader.js";
import { commandAvailable, runQuickstart } from "./core/quickstart.js";
import { ErrorCategory, errorMessage, formatCliError } from "./core/errors.js";
import { AsyncStructuredLogger } from "./core/logger.js";
import {
  compactContinuationResponse,
  compactExplicitHandoffResponse,
  decideContinuation,
  evaluateContinuationPreflight,
  loadContinuationSession,
  parseContinuationAgent,
} from "./continuation.js";
import {
  checkRepositoryDrift,
  formatRepositoryDrift,
  GitRepositorySnapshot,
} from "./core/git-snapshot.js";
import {
  assessHandoffReadiness,
  formatHandoffReadiness,
} from "./core/readiness.js";
import { HammaTaskState } from "./core/state.js";
import {
  benchmarkHandoff,
  formatContextEfficiencyBenchmark,
} from "./core/benchmark.js";
import {
  abandonMemory,
  attachMemory,
  checkpointMemory,
  finishMemory,
  formatMemoryInspection,
  formatMemoryList,
  formatMemoryRecall,
  inspectMemory,
  listMemories,
  recallMemory,
  resolveMemoryProjectPath,
  resumeMemory,
  startMemory,
  syncMemory,
} from "./core/memory.js";
import {
  simpleAsk,
  simpleDone,
  simpleSave,
  simpleSwitch,
} from "./core/simple-ux.js";
import { buildBootstrapContext } from "./core/bootstrap-context.js";
import {
  HOOK_AGENTS,
  HookAgent,
  HookInstallResult,
  HookUninstallResult,
  installHooks,
  uninstallHooks,
} from "./core/hooks-install.js";
import {
  launchCodexWithRecovery,
  recoverCodexLaunches,
  registerCodexSessionStart,
} from "./adapters/codex/runtime.js";

function truncate(s: string | undefined, max: number): string | undefined {
  if (!s) return s;
  return s.length > max ? s.slice(0, max) + "..." : s;
}

function renderSession(session: HammaSession, summary: boolean): string {
  if (!summary) return JSON.stringify(session, null, 2);

  const view = {
    meta: session.meta,
    messageCount: session.messages.length,
    shellCommandCount: session.shellCommands.length,
    parserWarningsCount: session.parserWarnings.length,
    redactionCount: session.security.redactionCount,
    firstMessages: session.messages.slice(0, 5).map((m) => ({
      ...m,
      content: truncate(m.content, 300)
    })),
    lastMessages: session.messages.slice(-5).map((m) => ({
      ...m,
      content: truncate(m.content, 300)
    })),
    lastShellCommands: session.shellCommands.slice(-10).map((c) => ({
      ...c,
      command: truncate(c.command, 200),
      output: c.output !== undefined ? "<omitted>" : undefined
    }))
  };
  return JSON.stringify(view, null, 2);
}

function printCountMap(label: string, counts: Record<string, number>) {
  const entries = Object.entries(counts).sort((a, b) => b[1] - a[1]);
  if (entries.length === 0) {
    console.log(`${label}: (none)`);
    return;
  }
  console.log(`${label}:`);
  for (const [k, v] of entries) console.log(`  ${k}: ${v}`);
}

function printClaudeShapeReport(report: ClaudeShapeReport) {
  console.log(pc.bold("Claude session shape inspection"));
  console.log(pc.yellow("(read-only — no message content, tool inputs, or outputs are printed)"));
  console.log("");
  console.log(`File: ${report.path}`);
  console.log(`Size: ${report.sizeBytes} bytes`);
  console.log(`Total non-empty lines: ${report.totalLines}`);
  console.log(`Parsed JSON lines: ${report.parsedLines}`);
  console.log(`Malformed lines: ${report.malformedLines}`);
  console.log("");

  printCountMap("Top-level key frequency", report.topLevelKeyFrequency);
  console.log("");
  printCountMap("Type field values", report.typeCounts);
  console.log("");
  printCountMap("Role values", report.roleCounts);
  console.log("");

  const typeShapes = Object.entries(report.shapeByType).sort((a, b) =>
    a[0].localeCompare(b[0])
  );
  if (typeShapes.length === 0) {
    console.log("Shape by type: (none)");
  } else {
    console.log("Shape by type:");
    for (const [t, shape] of typeShapes) {
      console.log(`  ${t}:`);
      const keys = Object.keys(shape).sort();
      for (const k of keys) console.log(`    ${k}: ${shape[k]}`);
    }
  }
  console.log("");

  if (report.cwdValues.length === 0) {
    console.log("Detected cwd values: (none)");
  } else {
    console.log("Detected cwd values:");
    for (const v of report.cwdValues) console.log(`  ${v}`);
  }

  if (report.projectPathValues.length === 0) {
    console.log("Detected projectPath values: (none)");
  } else {
    console.log("Detected projectPath values:");
    for (const v of report.projectPathValues) console.log(`  ${v}`);
  }
}

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const pkgPath = path.resolve(__dirname, "..", "package.json");
const pkg = JSON.parse(fs.readFileSync(pkgPath, "utf-8"));

const cliLogger = new AsyncStructuredLogger({ operation: "cli" });

function fail(category: ErrorCategory, error: unknown): void {
  cliLogger.error("operation.failed", {
    category,
    error: errorMessage(error)
  });
  console.error(pc.red(formatCliError(category, error)));
  process.exitCode = 1;
}

function failSimple(error: unknown): void {
  const message = errorMessage(error);
  cliLogger.error("operation.failed", { category: "SIMPLE_UX", error: message });
  console.error(pc.red(`Hamma couldn't complete that: ${message}`));
  console.error(pc.dim("Run `hamma` for a guided next step or add --help to the command."));
  process.exitCode = 1;
}

function reportCodexLauncherResult(result: Awaited<ReturnType<typeof launchCodexWithRecovery>>): void {
  if (result.setupWarning) {
    console.error(pc.yellow(`Hamma warning: ${result.setupWarning}`));
  }
  if (result.checkpoint?.status === "updated") {
    console.error(pc.green(
      `Hamma saved Codex session ${result.checkpoint.sessionId} to memory '${result.checkpoint.memory}'.`
    ));
  } else if (result.checkpoint?.status === "unchanged") {
    console.error(pc.dim("Hamma memory was already current when Codex exited."));
  } else if (result.checkpoint && ["pending", "failed"].includes(result.checkpoint.status)) {
    console.error(pc.yellow(
      `Hamma exit checkpoint is pending: ${result.checkpoint.reason ?? "it will be retried at the next session start."}`
    ));
  }
}

async function launchAttachedAgent(
  command: string,
  args: string[],
  cwd: string
): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const child = spawn(command, args, { cwd, stdio: "inherit" });
    child.on("error", (error: NodeJS.ErrnoException) => {
      if (error.code === "ENOENT") {
        reject(new Error(`${command} is not installed or is not on PATH.`));
      } else reject(error);
    });
    child.on("close", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`${command} exited with code ${code ?? "unknown"}.`));
    });
  });
}

async function simpleCommandAvailable(command: string): Promise<boolean> {
  return new Promise((resolve) => {
    const child = spawn(command, ["--version"], { stdio: "ignore" });
    child.on("error", () => resolve(false));
    child.on("close", (code) => resolve(code === 0));
  });
}

async function readJsonStdin(): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = [];
  let bytes = 0;
  for await (const chunk of process.stdin) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    bytes += buffer.byteLength;
    if (bytes > 1024 * 1024) {
      throw new Error("Hook event exceeds the 1 MiB input limit.");
    }
    chunks.push(buffer);
  }
  const input = Buffer.concat(chunks).toString("utf8").trim();
  if (!input) throw new Error("Hook sync expected a JSON event on stdin.");
  return JSON.parse(input) as Record<string, unknown>;
}

async function readOptionalJsonStdin(): Promise<Record<string, unknown> | undefined> {
  if (process.stdin.isTTY) return undefined;
  const chunks: Buffer[] = [];
  let bytes = 0;
  try {
    for await (const chunk of process.stdin) {
      const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      bytes += buffer.byteLength;
      if (bytes > 1024 * 1024) return undefined;
      chunks.push(buffer);
    }
    const input = Buffer.concat(chunks).toString("utf8").trim();
    if (!input) return undefined;
    const parsed = JSON.parse(input);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? parsed as Record<string, unknown>
      : undefined;
  } catch {
    // Session-start hooks are fail-open. Invalid input disables registration
    // for this event but must not suppress already-saved bootstrap context.
    return undefined;
  }
}

const program = new Command();

program
  .option(
    "--log-level <level>",
    "Structured log level: off | error | warn | info | debug",
    process.env.HAMMA_LOG_LEVEL ?? "off"
  )
  .hook("preAction", (_command, actionCommand) => {
    cliLogger.setLevel(actionCommand.optsWithGlobals().logLevel);
    cliLogger.setOperation(actionCommand.name());
    cliLogger.info("operation.started");
  })
  .hook("postAction", (_command, actionCommand) => {
    cliLogger.info("operation.completed", { exitCode: process.exitCode ?? 0 });
  });

program
  .name("hamma")
  .description("Keep AI coding work moving across Codex, Claude, and Grok")
  .version(pkg.version)
  .action(async () => {
    try {
      await runQuickstart(process.cwd());
    } catch (error: unknown) {
      fail("PROJECT_ERROR", error);
    }
  })
  .addHelpText("after", [
    "",
    "Simple workflow:",
    "  hamma save                 Save the current coding session",
    "  hamma codex                Launch Codex with reliable exit recovery",
    "  hamma switch claude        Save and move the work to Claude",
    "  hamma done                 Mark the current work complete",
    "  hamma ask \"why SQLite?\"  Search project memory",
    "",
    "Advanced memory controls remain under `hamma memory`.",
  ].join("\n"));

program
  .command("save")
  .option("--agent <agent>", "Current agent when auto-detection is ambiguous")
  .option("--memory <name>", "Memory name; defaults to the active/default memory")
  .option("--project <path>", "Project directory")
  .option("--json", "Print a machine-readable result")
  .option("--no-gitignore", "Do not modify .gitignore")
  .description("Save the current coding session to project memory")
  .action(async (options) => {
    try {
      const projectPath = resolveMemoryProjectPath(options.project ?? process.cwd());
      if (!options.json) console.log(pc.dim("Finding the current agent session…"));
      const result = await simpleSave(projectPath, {
        agent: options.agent,
        memory: options.memory,
        useGitignore: options.gitignore,
      });
      if (options.json) {
        process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
        return;
      }
      console.log(pc.green("✓ Current work saved"));
      console.log(`  Agent: ${result.source.agent}`);
      console.log(`  Memory: ${result.memory}`);
      console.log(`  State: ${result.outcome ?? "saved"}`);
      console.log(`  Revision: ${result.revision ?? "already up to date"}`);
      if (result.attachId) console.log(pc.dim("  Active transferred task checkpointed."));
      if (result.nextAction) console.log(`  Next: ${result.nextAction}`);
      for (const warning of result.warnings) console.log(pc.yellow(`  Warning: ${warning}`));
      const suggestedTarget = result.source.agent === "claude" ? "codex" : "claude";
      console.log(pc.dim(`\nSwitch agents with: hamma switch ${suggestedTarget}`));
    } catch (err: any) {
      return failSimple(err);
    }
  });

program
  .command("switch")
  .argument("<agent>", "Destination: codex | claude | grok")
  .option("--from <agent>", "Current agent when auto-detection is ambiguous")
  .option("--memory <name>", "Memory name; defaults to the active/default memory")
  .option("--project <path>", "Project directory")
  .option("--no-save", "Use the frozen saved memory without saving first")
  .option("--no-launch", "Print the launch command without starting the agent")
  .option("--start", "Start the target even when this shell is non-interactive")
  .option("--json", "Print a machine-readable result without launching")
  .option("--no-gitignore", "Do not modify .gitignore")
  .description("Save the work and move it to another coding agent")
  .action(async (agent, options) => {
    try {
      const projectPath = resolveMemoryProjectPath(options.project ?? process.cwd());
      const shouldLaunch = !options.json && options.launch !== false && (
        options.start || (Boolean(process.stdin.isTTY) && Boolean(process.stdout.isTTY))
      );
      if (shouldLaunch && !await simpleCommandAvailable(String(agent).toLowerCase())) {
        throw new Error(`${agent} is not installed or is not on PATH. Install it, or use --no-launch to prepare and print the command only.`);
      }
      if (!options.json) console.log(pc.dim(`Saving work and preparing ${agent}…`));
      const result = await simpleSwitch(projectPath, agent, {
        from: options.from,
        memory: options.memory,
        save: options.save,
        useGitignore: options.gitignore,
      });
      if (options.json) {
        process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
        return;
      }
      if (result.saved) console.log(pc.green("✓ Current work saved"));
      else console.log(pc.green("✓ Saved memory is current"));
      if (result.source) console.log(`  Source: ${result.source.agent}`);
      if (result.transferredClaim) console.log(pc.green("✓ Previous agent claim released"));
      console.log(pc.green(`✓ Context prepared for ${result.target}`));
      console.log(`  Memory: ${result.memory}`);
      console.log(`  State: ${result.attach.previousOutcome}`);
      console.log(`  Mode: ${result.attach.executionMode}`);
      if (result.attach.attachId) console.log(pc.dim("  Task ownership is protected until `hamma done`."));
      for (const warning of result.attach.warnings) console.log(pc.yellow(`  Warning: ${warning}`));
      if (!shouldLaunch) {
        console.log("\nRun this command to open the agent:");
        console.log(result.attach.suggestedCommand);
        return;
      }
      console.log(pc.cyan(`\nOpening ${result.target}…`));
      if (result.target === "codex") {
        const launched = await launchCodexWithRecovery({
          projectPath,
          memory: result.memory,
          command: result.attach.launch.command,
          args: result.attach.launch.args,
        });
        reportCodexLauncherResult(launched);
        process.exitCode = launched.exitCode;
      } else {
        await launchAttachedAgent(
          result.attach.launch.command,
          result.attach.launch.args,
          projectPath
        );
      }
    } catch (err: any) {
      return failSimple(err);
    }
  });

program
  .command("done")
  .option("--agent <agent>", "Current agent when auto-detection is ambiguous")
  .option("--memory <name>", "Memory name; defaults to the active memory")
  .option("--blocked", "Save the task as blocked instead of completed")
  .option("--next <text>", "Next action when the task is blocked")
  .option("--project <path>", "Project directory")
  .option("--json", "Print a machine-readable result")
  .option("--no-gitignore", "Do not modify .gitignore")
  .description("Save the current session and close its task")
  .action(async (options) => {
    try {
      if (options.blocked && !options.next) {
        throw new Error("Blocked work needs a next step. Add --next \"what must happen next\".");
      }
      const projectPath = resolveMemoryProjectPath(options.project ?? process.cwd());
      if (!options.json) console.log(pc.dim("Saving the final session…"));
      const result = await simpleDone(projectPath, {
        agent: options.agent,
        memory: options.memory,
        outcome: options.blocked ? "blocked" : "completed",
        nextAction: options.next,
        useGitignore: options.gitignore,
      });
      if (options.json) {
        process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
        return;
      }
      console.log(pc.green(options.blocked ? "✓ Work saved as blocked" : "✓ Work completed and saved"));
      console.log(`  Agent: ${result.source.agent}`);
      console.log(`  Memory: ${result.memory}`);
      console.log(`  Revision: ${result.revision ?? "already up to date"}`);
      if (result.attachId) console.log(pc.dim("  The agent claim is now closed."));
      for (const warning of result.warnings) console.log(pc.yellow(`  Warning: ${warning}`));
      console.log(pc.dim("\nThe history remains available, but Hamma will not repeat this work."));
    } catch (err: any) {
      return failSimple(err);
    }
  });

program
  .command("codex [codexArgs...]")
  .option("--memory <name>", "Memory to checkpoint; defaults to the active memory")
  .option("--project <path>", "Project directory and Codex working directory")
  .option("--codex-bin <command>", "Codex executable to launch", "codex")
  .allowUnknownOption(true)
  .description("Launch Codex with exact-session exit checkpointing and crash recovery")
  .action(async (codexArgs: string[] | undefined, options) => {
    try {
      const projectPath = resolveMemoryProjectPath(options.project ?? process.cwd());
      const result = await launchCodexWithRecovery({
        projectPath,
        memory: options.memory,
        command: options.codexBin,
        args: codexArgs ?? [],
      });
      reportCodexLauncherResult(result);
      process.exitCode = result.exitCode;
    } catch (err: any) {
      return failSimple(err);
    }
  });

program
  .command("ask")
  .argument("<query...>", "Question, phrase, decision, or file path")
  .option("--memory <name>", "Memory name; defaults to the active memory")
  .option("--limit <n>", "Maximum results", "5")
  .option("--project <path>", "Project directory")
  .option("--json", "Print machine-readable recall results")
  .description("Search this project's saved memory")
  .action(async (queryParts, options) => {
    try {
      const projectPath = resolveMemoryProjectPath(options.project ?? process.cwd());
      const result = await simpleAsk(
        projectPath,
        (queryParts as string[]).join(" "),
        options.memory,
        Number(options.limit)
      );
      if (options.json) {
        process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
        return;
      }
      console.log(pc.bold(`Project memory: ${result.memory}\n`));
      process.stdout.write(`${formatMemoryRecall(result)}\n`);
    } catch (err: any) {
      return failSimple(err);
    }
  });

program
  .command("list")
  .argument("<source>", "source CLI: codex | claude | grok")
  .option("--project <path>", "Filter and rank sessions for a project (claude/codex/grok)")
  .option("--json", "Print machine-readable session metadata")
  .description("List sessions from a source CLI")
  .action(async (source, options) => {
    if (source === "codex") {
      if (options.project) {
        try {
          const result = await CodexAdapter.listProject(
            path.resolve(options.project)
          );
          if (options.json) {
            process.stdout.write(
              `${JSON.stringify({ schemaVersion: 1, ...result }, null, 2)}\n`
            );
            return;
          }
          console.log(pc.bold(`Codex sessions for ${result.projectPath}:\n`));
          if (result.candidates.length === 0) {
            console.log(pc.yellow("No Codex sessions found for this project."));
            return;
          }
          result.candidates.slice(0, 20).forEach((candidate, index) => {
            const id = candidate.sessionId ?? "unknown-conversation-id";
            console.log(
              `${index + 1}. ${pc.cyan(candidate.lastUpdatedAt)} ${id} ` +
              `[${candidate.confidence}, score ${candidate.score}]`
            );
            console.log(`   ${candidate.path}`);
            console.log(
              `   resumable: ${candidate.resumable ? "yes" : "no"}  ` +
              `signals: ${candidate.signals.join(", ") || "none"}`
            );
            if (candidate.reasons.length > 0) {
              console.log(`   reasons: ${candidate.reasons.join("; ")}`);
            }
          });
          return;
        } catch (err: any) {
          return fail("SESSION_ERROR", err);
        }
      }
      const sessions = await CodexAdapter.list();
      if (options.json) {
        process.stdout.write(`${JSON.stringify(sessions, null, 2)}\n`);
        return;
      }

      if (sessions.length === 0) {
        console.log(pc.yellow("No Codex sessions found."));
        return;
      }

      console.log(pc.bold(`Codex sessions found: ${sessions.length}\n`));

      sessions.slice(0, 20).forEach((s, i) => {
        console.log(`${i + 1}. ${pc.cyan(s.startedAt ?? "unknown-time")} ${s.conversationId}`);
        console.log(`   ${s.path}`);
        console.log(`   updated: ${s.lastUpdatedAt ?? "unknown"} size: ${s.sizeBytes ?? 0} bytes`);
      });
      return;
    }

    if (source === "claude") {
      if (options.project) {
        try {
          const result = await ClaudeAdapter.listProject(
            path.resolve(options.project)
          );
          if (options.json) {
            process.stdout.write(
              `${JSON.stringify({ schemaVersion: 1, ...result }, null, 2)}\n`
            );
            return;
          }
          console.log(pc.bold(`Claude sessions for ${result.projectPath}:\n`));
          if (result.candidates.length === 0) {
            console.log(pc.yellow("No Claude sessions found for this project."));
            return;
          }
          result.candidates.slice(0, 20).forEach((candidate, index) => {
            const id = candidate.sessionId ?? "unknown-session-id";
            console.log(
              `${index + 1}. ${pc.cyan(candidate.lastUpdatedAt)} ${id} ` +
              `[${candidate.confidence}, score ${candidate.score}]`
            );
            console.log(`   ${candidate.path}`);
            console.log(
              `   resumable: ${candidate.resumable ? "yes" : "no"}  ` +
              `signals: ${candidate.signals.join(", ") || "none"}`
            );
            if (candidate.reasons.length > 0) {
              console.log(`   reasons: ${candidate.reasons.join("; ")}`);
            }
          });
          return;
        } catch (err: any) {
          return fail("SESSION_ERROR", err);
        }
      }

      const sessions = await ClaudeAdapter.list();
      if (options.json) {
        process.stdout.write(`${JSON.stringify(sessions, null, 2)}\n`);
        return;
      }

      console.log(pc.yellow("Claude Code discovery is read-only and experimental — no files are modified."));

      if (sessions.length === 0) {
        console.log(pc.yellow("\nNo Claude Code session files found."));
        console.log(
          "Looked under ~/.claude, ~/.config/claude, and ~/.local/share/claude for projects/**/*.jsonl, sessions/**/*.jsonl, and history/**/*.jsonl."
        );
        console.log("If Claude Code is installed elsewhere on this machine, this is expected.");
        return;
      }

      console.log(pc.bold(`\nCandidate Claude session files: ${sessions.length}\n`));

      sessions.slice(0, 20).forEach((s, i) => {
        const idLabel = s.sessionId ?? "unknown-session-id";
        console.log(`${i + 1}. ${pc.cyan(s.lastUpdatedAt)} ${idLabel}`);
        console.log(`   ${s.path}`);
        console.log(
          `   size: ${s.sizeBytes} bytes  home: ${s.claudeHome}${s.projectPathHint ? `  cwd hint: ${s.projectPathHint}` : ""}`
        );
      });

      if (sessions.length > 20) {
        console.log(pc.dim(`\n… ${sessions.length - 20} more not shown.`));
      }
      return;
    }

    if (source === "grok") {
      try {
        let sessions: any[] = [];
        if (options.project) {
          const result = await GrokAdapter.listProject(path.resolve(options.project));
          sessions = result.candidates;
          if (options.json) {
            process.stdout.write(
              `${JSON.stringify({ schemaVersion: 1, ...result }, null, 2)}\n`
            );
            return;
          }
          console.log(pc.bold(`Grok sessions for ${result.projectPath}:\n`));
        } else {
          sessions = await GrokAdapter.list();
          if (options.json) {
            process.stdout.write(
              `${JSON.stringify({ schemaVersion: 1, sessions }, null, 2)}\n`
            );
            return;
          }
          console.log(pc.bold(`\nGrok sessions (newest first): ${sessions.length}\n`));
        }

        if (sessions.length === 0) {
          console.log(pc.yellow("No Grok sessions found."));
          console.log("Looked under ~/.grok/sessions/<encoded-cwd>/<id>/summary.json");
          return;
        }

        sessions.slice(0, 20).forEach((s: any, i: number) => {
          const idLabel = s.sessionId ?? "unknown";
          const cwd = s.projectPathHint ? `  cwd: ${s.projectPathHint}` : "";
          console.log(`${i + 1}. ${pc.cyan(s.lastUpdatedAt)} ${idLabel}`);
          console.log(`   dir: ${s.sessionDir || s.path || ""}${cwd}`);
        });
        if (sessions.length > 20) {
          console.log(pc.dim(`\n… ${sessions.length - 20} more not shown.`));
        }
        return;
      } catch (err: any) {
        return fail("SESSION_ERROR", err);
      }
    }

    return fail(
      "CLI_ERROR",
      new Error(`Unsupported source '${source}'. Supported: 'codex', 'claude', 'grok'.`)
    );
  });

program
  .command("inspect")
  .argument(
    "<target>",
    "codex:last | codex:<id> | claude:last | claude:<id> | grok:last | grok:project | grok:<sessionId> | session JSONL path"
  )
  .option("--summary", "Print a summarized view (meta, counts, head/tail messages)")
  .option(
    "--shape",
    "Read-only shape report for Claude targets — no message content is printed"
  )
  .description("Inspect one session")
  .action(async (target, options) => {
    if (options.shape) {
      try {
        const resolved = await resolveSessionTarget(target);
        if (resolved.sourceCli !== "claude") {
          throw new Error("--shape is only supported for Claude sessions.");
        }
        const report = await ClaudeAdapter.inspectShape(resolved.sessionPath);
        printClaudeShapeReport(report);
        return;
      } catch (err: any) {
        return fail("SESSION_ERROR", err);
      }
    }

    try {
      const session = await loadSession(target);
      console.log(renderSession(session, Boolean(options.summary)));
    } catch (err: any) {
      return fail("SESSION_ERROR", err);
    }
  });

program
  .command("handoff")
  .argument(
    "<target>",
    "codex:last | codex:project | ... | claude:last | claude:project | ... | grok:last | grok:project | grok:<sessionId> | session JSONL path"
  )
  .requiredOption("--to <agent>", "Target CLI (claude | codex | grok | other)")
  .option("--project <path>", "Project used to resolve :project/:current/:previous for claude/codex/grok")
  .option("--preflight", "Assess the explicit session without creating a handoff")
  .option("--json", "Print only a machine-readable handoff result")
  .option("--compact-json", "Print a bounded one-line JSON result for agent skills")
  .option("--no-gitignore", "Do not modify .gitignore")
  .description("Create a handoff package for another agent")
  .action(async (target, options) => {
    try {
      const PROJECT_SCOPED = new Set([
        "claude:project", "claude:current", "claude:previous",
        "codex:project", "codex:current", "codex:previous",
        "grok:project", "grok:current", "grok:previous",
      ]);
      const isProjectTarget = PROJECT_SCOPED.has(target);
      const projectPath = options.project
        ? path.resolve(options.project)
        : isProjectTarget
          ? process.cwd()
          : undefined;
      const session = await loadSession(target, { projectPath });
      if (projectPath) {
        session.meta.projectPath = projectPath;
      }
      const compactJson = Boolean(options.compactJson);
      const structuredPreflight = Boolean(options.preflight || compactJson);
      const targetCli = structuredPreflight
        ? parseContinuationAgent(options.to)
        : undefined;
      const effectiveProjectPath = session.meta.projectPath
        ? path.resolve(session.meta.projectPath)
        : undefined;
      const evaluation = structuredPreflight
        ? effectiveProjectPath && targetCli
          ? evaluateContinuationPreflight(
              session,
              targetCli,
              effectiveProjectPath
            )
          : undefined
        : undefined;
      if (structuredPreflight && !evaluation) {
        throw new Error(
          "Handoff preflight requires a project path. Pass --project <path> or use a session that records its project."
        );
      }
      if (options.preflight) {
        const preflight = evaluation!.preflight;
        if (compactJson) {
          process.stdout.write(
            `${JSON.stringify(compactExplicitHandoffResponse(
              session,
              effectiveProjectPath!,
              targetCli!,
              preflight,
              null,
              "preflight"
            ))}\n`
          );
          return;
        }
        if (options.json) {
          process.stdout.write(
            `${JSON.stringify({
              schemaVersion: 1,
              mode: "preflight",
              projectPath: effectiveProjectPath,
              targetCli,
              source: {
                sourceCli: session.meta.sourceCli,
                sessionId: session.meta.sourceSessionId,
              },
              preflight,
              handoff: null,
            }, null, 2)}\n`
          );
          return;
        }
        console.log(pc.bold("Explicit handoff preflight"));
        console.log(
          `Source: ${session.meta.sourceCli}:${session.meta.sourceSessionId}`
        );
        console.log(`Current outcome: ${preflight.outcome}`);
        console.log(`Handoff readiness: ${preflight.readiness.level}`);
        console.log("");
        console.log(preflight.recommendation);
        console.log(pc.dim("No handoff was created."));
        return;
      }
      const result = await createHandoff(
        session,
        options.to,
        options.gitignore,
        { quiet: Boolean(options.json || compactJson) }
      );
      if (compactJson) {
        process.stdout.write(
          `${JSON.stringify(compactExplicitHandoffResponse(
            session,
            effectiveProjectPath!,
            targetCli!,
            evaluation!.preflight,
            result,
            "result"
          ))}\n`
        );
        return;
      }
      if (options.json) {
        process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
      }
    } catch (err: any) {
      return fail("HANDOFF_ERROR", err);
    }
  });

program
  .command("continue")
  .requiredOption("--to <agent>", "Target CLI (codex | claude | grok)")
  .option("--project <path>", "Project whose sessions should be considered")
  .option("--dry-run", "Explain the selection without creating a handoff")
  .option("--explain", "Show the ranked selection decision without creating a handoff")
  .option("--include-target-source", "Allow sessions from the destination agent")
  .option("--force", "Create an inspection handoff even when preflight withholds automatic continuation")
  .option("--json", "Print only a machine-readable decision/result")
  .option("--compact-json", "Print a bounded one-line JSON result for agent skills")
  .option("--no-gitignore", "Do not modify .gitignore")
  .description("Select the best cross-agent project session and create a continuation handoff")
  .action(async (options) => {
    try {
      const targetCli = parseContinuationAgent(options.to);
      const projectPath = path.resolve(options.project ?? process.cwd());
      const decision = await decideContinuation(projectPath, targetCli, {
        includeTargetSource: Boolean(options.includeTargetSource),
      });
      const dryRun = Boolean(options.dryRun || options.explain);
      const session = await loadContinuationSession(decision.selected);
      session.meta.projectPath = decision.projectPath;
      const { preflight } = evaluateContinuationPreflight(
        session,
        targetCli,
        decision.projectPath
      );
      const compactJson = Boolean(options.compactJson);
      const jsonOutput = Boolean(options.json || compactJson);

      if (dryRun) {
        if (compactJson) {
          process.stdout.write(
            `${JSON.stringify(compactContinuationResponse(decision, preflight, null, "preflight"))}\n`
          );
          return;
        }
        if (options.json) {
          process.stdout.write(
            `${JSON.stringify({ ...decision, preflight }, null, 2)}\n`
          );
          return;
        }
        console.log(pc.bold("Continuation selection (dry run)"));
        console.log(`Project: ${decision.projectPath}`);
        console.log(`Target: ${decision.targetCli}`);
        console.log(
          `Selected: ${decision.selected.sourceCli}:${decision.selected.sessionId ?? "unknown"}`
        );
        console.log(
          `Confidence: ${decision.selected.confidence}  Score: ${decision.selected.score}`
        );
        console.log(`Current outcome: ${preflight.outcome}`);
        console.log(`Handoff readiness: ${preflight.readiness.level}`);
        for (const line of decision.explanation) console.log(`- ${line}`);
        console.log("");
        console.log(preflight.recommendation);
        console.log(pc.dim("No handoff was created."));
        return;
      }

      if (!preflight.shouldCreateHandoff && !options.force) {
        if (compactJson) {
          process.stdout.write(
            `${JSON.stringify(compactContinuationResponse(decision, preflight, null, "result"))}\n`
          );
          return;
        }
        if (options.json) {
          process.stdout.write(
            `${JSON.stringify({
              schemaVersion: 1,
              selection: decision,
              preflight,
              handoff: null,
            }, null, 2)}\n`
          );
          return;
        }
        console.log(pc.bold("Continuation preflight"));
        console.log(`Selected: ${decision.selected.sourceCli}:${decision.selected.sessionId ?? "unknown"}`);
        console.log(`Current outcome: ${preflight.outcome}`);
        console.log(`Handoff readiness: ${preflight.readiness.level}`);
        console.log("");
        console.log(preflight.recommendation);
        console.log(pc.dim("No handoff was created. Use --force to create an inspection artifact."));
        return;
      }

      const handoff = await createHandoff(
        session,
        targetCli,
        options.gitignore,
        { quiet: jsonOutput }
      );
      if (compactJson) {
        process.stdout.write(
          `${JSON.stringify(compactContinuationResponse(decision, preflight, handoff, "result"))}\n`
        );
        return;
      }
      if (options.json) {
        process.stdout.write(
          `${JSON.stringify({ schemaVersion: 1, selection: decision, preflight, handoff }, null, 2)}\n`
        );
        return;
      }
      console.log("");
      console.log(pc.bold("Why this session:"));
      for (const line of decision.explanation) console.log(`- ${line}`);
    } catch (err: any) {
      return fail("HANDOFF_ERROR", err);
    }
  });

program
  .command("status")
  .option("--project <path>", "Project directory to inspect")
  .description("Show a read-only project and local session overview")
  .action(async (options) => {
    const projectPath = path.resolve(options.project ?? process.cwd());
    try {
      console.log(formatProjectStatus(await getProjectStatus(projectPath)));
    } catch (err: any) {
      return fail("PROJECT_ERROR", err);
    }
  });

program
  .command("log")
  .option("--project <path>", "Project whose local handoff history should be listed")
  .description("List local handoffs for a project, newest first")
  .action(async (options) => {
    const projectPath = path.resolve(options.project ?? process.cwd());
    try {
      const handoffs = await listHandoffs(projectPath);
      if (handoffs.length === 0) {
        console.log(pc.yellow(`No handoffs found in ${path.join(projectPath, ".hamma", "tasks")}.`));
        return;
      }
      console.log(formatHandoffLog(handoffs));
    } catch (err: any) {
      return fail("HISTORY_ERROR", err);
    }
  });

program
  .command("show")
  .argument("<task-id>", "Handoff task id or 'latest'")
  .option(
    "--check-drift",
    "Compare the handoff Git snapshot with the live repository"
  )
  .option("--readiness", "Assess whether the handoff is ready to continue")
  .option("--json", "Print a machine-readable drift/readiness result")
  .description("Print a local handoff brief")
  .action(async (taskId, options) => {
    try {
      if (options.checkDrift || options.readiness) {
        const record = await readHandoffRecord(process.cwd(), taskId);
        const state = record.state as (Partial<HammaTaskState> & {
          repoState?: { snapshot?: GitRepositorySnapshot };
        }) | undefined;
        const drift = checkRepositoryDrift(
          process.cwd(),
          state?.repoState?.snapshot
        );
        const readiness = options.readiness
          ? assessHandoffReadiness(state, drift)
          : undefined;
        if (options.json) {
          process.stdout.write(
            `${JSON.stringify({
              schemaVersion: 1,
              taskId: record.taskId,
              handoffPath: record.handoffPath,
              ...(options.checkDrift || options.readiness ? { drift } : {}),
              ...(readiness ? { readiness } : {}),
            }, null, 2)}\n`
          );
          return;
        }
        const reports: string[] = [];
        if (options.checkDrift) reports.push(formatRepositoryDrift(drift));
        if (readiness) reports.push(formatHandoffReadiness(readiness));
        process.stdout.write(
          `${record.markdown.endsWith("\n") ? record.markdown : record.markdown + "\n"}` +
          `\n${reports.join("\n\n")}\n`
        );
        return;
      }
      const markdown = await readHandoff(process.cwd(), taskId);
      process.stdout.write(markdown.endsWith("\n") ? markdown : markdown + "\n");
    } catch (err: any) {
      return fail("HISTORY_ERROR", err);
    }
  });

program
  .command("benchmark")
  .argument("<task-id>", "Handoff task id or 'latest'")
  .option("--project <path>", "Project whose local handoff should be benchmarked")
  .option("--json", "Print a machine-readable benchmark")
  .description("Compare normalized source context with bounded initial context")
  .action(async (taskId, options) => {
    try {
      const projectPath = path.resolve(options.project ?? process.cwd());
      const record = await readHandoffRecord(projectPath, taskId);
      const benchmark = await benchmarkHandoff(record.taskPath, record.taskId);
      if (options.json) {
        process.stdout.write(`${JSON.stringify(benchmark, null, 2)}\n`);
        return;
      }
      process.stdout.write(`${formatContextEfficiencyBenchmark(benchmark)}\n`);
    } catch (err: any) {
      return fail("HISTORY_ERROR", err);
    }
  });

program
  .command("bootstrap")
  .option("--memory <name>", "Memory name; defaults to the active memory")
  .option("--project <path>", "Project directory")
  .option("--hook-agent <agent>", "Emit for a native SessionStart hook: codex | claude | grok")
  .option("--json", "Print a machine-readable result")
  .description("Recover ended Codex launches and print bounded project-memory context")
  .action(async (options) => {
    // Unlike sync hooks, bootstrap intentionally writes stdout on success:
    // agents inject SessionStart hook stdout into model context. In hook mode
    // every failure is swallowed to a silent exit 0 so a broken memory store
    // can never block or pollute session start.
    try {
      let hookAgent: "codex" | "claude" | "grok" | undefined;
      let hookEvent: Record<string, unknown> | undefined;
      if (options.hookAgent) {
        hookAgent = parseContinuationAgent(options.hookAgent);
        hookEvent = await readOptionalJsonStdin();
      }
      const projectPath = resolveMemoryProjectPath(options.project ?? process.cwd());
      if (hookAgent) {
        try {
          if (hookAgent === "codex" && hookEvent) {
            await registerCodexSessionStart(projectPath, hookEvent);
          }
          const recoveries = await recoverCodexLaunches(projectPath);
          for (const recovery of recoveries) {
            if (["pending", "failed"].includes(recovery.status)) {
              cliLogger.warn("codex.recovery.pending", {
                launchId: recovery.launchId,
                sessionId: recovery.sessionId,
                reason: recovery.reason,
              });
            }
          }
        } catch (runtimeError) {
          // Recovery is best-effort at startup. Existing frozen memory remains
          // useful even when a runtime marker is malformed or temporarily busy.
          cliLogger.warn("codex.recovery.failed", { error: errorMessage(runtimeError) });
        }
      }
      const result = await buildBootstrapContext(projectPath, { memory: options.memory });
      if (options.json) {
        process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
        return;
      }
      if (result.status === "ready") {
        process.stdout.write(result.context ?? "");
        return;
      }
      if (!options.hookAgent) {
        console.log(pc.dim(`No session-start context (${result.reason}).`));
      }
    } catch (err: any) {
      if (options.hookAgent) {
        cliLogger.error("operation.failed", { category: "HISTORY_ERROR", error: errorMessage(err) });
        return;
      }
      return fail("HISTORY_ERROR", err);
    }
  });

const memoryCommand = program
  .command("memory")
  .description("Maintain persistent repository knowledge and task epochs across coding agents");

memoryCommand
  .command("start")
  .argument("<name>", "Stable project memory name")
  .option("--goal <text>", "Optional original goal")
  .option("--project <path>", "Project directory")
  .option("--json", "Print machine-readable memory metadata")
  .option("--no-gitignore", "Do not modify .gitignore")
  .description("Create and activate a named project memory")
  .action(async (name, options) => {
    try {
      const projectPath = resolveMemoryProjectPath(options.project ?? process.cwd());
      const manifest = await startMemory(
        projectPath,
        name,
        options.goal,
        options.gitignore
      );
      if (options.json) {
        process.stdout.write(`${JSON.stringify(manifest, null, 2)}\n`);
        return;
      }
      console.log(pc.green(`Project memory '${manifest.name}' is active.`));
      console.log(`Project: ${manifest.projectPath}`);
      console.log(`Next: hamma memory sync --source <agent>:<session-id>`);
    } catch (err: any) {
      return fail("HANDOFF_ERROR", err);
    }
  });

memoryCommand
  .command("list")
  .option("--project <path>", "Project directory")
  .option("--json", "Print a machine-readable memory list")
  .description("List named project memories")
  .action(async (options) => {
    try {
      const projectPath = resolveMemoryProjectPath(options.project ?? process.cwd());
      const memories = await listMemories(projectPath);
      if (options.json) {
        process.stdout.write(`${JSON.stringify({ schemaVersion: 2, projectPath, memories }, null, 2)}\n`);
        return;
      }
      process.stdout.write(`${formatMemoryList(memories)}\n`);
    } catch (err: any) {
      return fail("HISTORY_ERROR", err);
    }
  });

memoryCommand
  .command("show")
  .argument("[name]", "Memory name; defaults to the active memory")
  .option("--project <path>", "Project directory")
  .option("--json", "Print machine-readable memory state")
  .description("Show latest state, drift, and readiness for a project memory")
  .action(async (name, options) => {
    try {
      const projectPath = resolveMemoryProjectPath(options.project ?? process.cwd());
      const inspection = await inspectMemory(projectPath, name);
      if (options.json) {
        process.stdout.write(`${JSON.stringify(inspection, null, 2)}\n`);
        return;
      }
      process.stdout.write(`${formatMemoryInspection(inspection)}\n`);
    } catch (err: any) {
      return fail("HISTORY_ERROR", err);
    }
  });

memoryCommand
  .command("sync")
  .argument("[name]", "Memory name; defaults to the active memory")
  .option("--source <target>", "Exact source session, for example codex:current or claude:<id>")
  .option("--update-file <path>", "Validated structured memory update JSON")
  .option("--hook-agent <agent>", "Read a native hook event from stdin: codex | claude | grok")
  .option("--project <path>", "Project directory")
  .option("--json", "Print a machine-readable sync result")
  .option("--no-gitignore", "Do not modify .gitignore")
  .description("Create an immutable memory revision from an exact project session")
  .action(async (name, options) => {
    try {
      const projectPath = resolveMemoryProjectPath(options.project ?? process.cwd());
      let source = options.source as string | undefined;
      if (options.hookAgent) {
        const agent = parseContinuationAgent(options.hookAgent);
        const event = await readJsonStdin();
        const sessionId = event.session_id ?? event.sessionId;
        if (typeof sessionId !== "string" || !sessionId.trim()) {
          throw new Error("Hook event did not provide a session identifier.");
        }
        source = `${agent}:${sessionId}`;
      }
      const result = await syncMemory(projectPath, name, {
        source,
        updateFile: options.updateFile,
        useGitignore: options.gitignore,
        lifecycleHook: Boolean(options.hookAgent),
      });
      if (options.json) {
        process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
        return;
      }
      if (options.hookAgent) return;
      console.log(pc.bold(`Project memory: ${result.memory}`));
      console.log(result.updated ? pc.green(`Revision created: ${result.revision?.id}`) : pc.yellow("No new revision created."));
      if (result.reason) console.log(`Reason: ${result.reason}`);
      for (const line of result.selection.explanation) console.log(`- ${line}`);
      if (result.warnings.length > 0) {
        console.log("Warnings:");
        for (const warning of result.warnings) console.log(`- ${warning}`);
      }
    } catch (err: any) {
      if (
        options.hookAgent &&
        (String(err.message).includes("No active project memory") ||
          String(err.message).includes("lifecycle sync skipped"))
      ) {
        if (options.json) {
          process.stdout.write(`${JSON.stringify({ schemaVersion: 2, updated: false, skipped: true, reason: err.message }, null, 2)}\n`);
        }
        return;
      }
      return fail("HANDOFF_ERROR", err);
    }
  });

memoryCommand
  .command("attach")
  .argument("[name]", "Memory name; defaults to active, creating 'default' when absent")
  .requiredOption("--to <agent>", "Target CLI: codex | claude | grok")
  .option("--source <target>", "Exact source session to synchronize before attach")
  .option("--no-sync", "Load the frozen latest revision without synchronizing")
  .option("--project <path>", "Project directory")
  .option("--json", "Print a machine-readable attach contract")
  .description("Load repository memory into an agent with execution safeguards")
  .action(async (name, options) => {
    try {
      const targetCli = parseContinuationAgent(options.to);
      const projectPath = resolveMemoryProjectPath(options.project ?? process.cwd());
      const result = await attachMemory(projectPath, name, targetCli, {
        source: options.source,
        noSync: options.sync === false,
      });
      if (options.json) {
        process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
        return;
      }
      console.log(pc.bold(`Attach repository memory '${result.memory}' in ${result.targetCli}`));
      console.log(`Execution mode: ${result.executionMode}`);
      console.log(`Memory load: ${result.memoryLoadAllowed ? "allowed" : "withheld"}`);
      console.log(`Automatic execution: ${result.autoExecuteAllowed ? "allowed" : "withheld"}`);
      console.log(`Sync: ${result.syncStatus}`);
      if (result.attachId) console.log(`Attach run: ${result.attachId}`);
      console.log(`Repository drift: ${result.drift.detected ? result.drift.categories.join(", ") : "none"}`);
      console.log(`Initial context + prompt: ${result.contextBudget.combinedBytes}/${result.contextBudget.maxBytes} bytes`);
      for (const warning of result.warnings) console.log(pc.yellow(`Warning: ${warning}`));
      console.log("");
      console.log(result.suggestedCommand);
    } catch (err: any) {
      return fail("HANDOFF_ERROR", err);
    }
  });

memoryCommand
  .command("checkpoint")
  .argument("[name]", "Memory name; defaults to the active memory")
  .requiredOption("--attach <id>", "Attach run identifier returned by memory attach")
  .requiredOption("--source <target>", "Exact attached agent session, for example codex:<id>")
  .option("--update-file <path>", "Optional structured memory update JSON")
  .option("--project <path>", "Project directory")
  .option("--json", "Print a machine-readable checkpoint result")
  .option("--no-gitignore", "Do not modify .gitignore")
  .description("Checkpoint the exact attached session into its original task epoch")
  .action(async (name, options) => {
    try {
      const projectPath = resolveMemoryProjectPath(options.project ?? process.cwd());
      const result = await checkpointMemory(projectPath, name, options.attach, {
        source: options.source,
        updateFile: options.updateFile,
        useGitignore: options.gitignore,
      });
      if (options.json) {
        process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
        return;
      }
      console.log(pc.green(`Attach run ${result.attachId} checkpointed.`));
      console.log(`Status: ${result.run.status}`);
      console.log(`Revision: ${result.revision?.id ?? "unchanged"}`);
    } catch (err: any) {
      return fail("HANDOFF_ERROR", err);
    }
  });

memoryCommand
  .command("finish")
  .argument("[name]", "Memory name; defaults to the active memory")
  .requiredOption("--attach <id>", "Attach run identifier returned by memory attach")
  .requiredOption("--source <target>", "Exact attached agent session, for example codex:<id>")
  .option("--update-file <path>", "Optional structured memory update JSON")
  .option("--outcome <outcome>", "Final outcome: completed | blocked", "completed")
  .option("--project <path>", "Project directory")
  .option("--json", "Print a machine-readable finish result")
  .option("--no-gitignore", "Do not modify .gitignore")
  .description("Write back the exact attached session and close its task epoch")
  .action(async (name, options) => {
    try {
      if (options.outcome !== "completed" && options.outcome !== "blocked") {
        throw new Error("Finish outcome must be completed or blocked.");
      }
      const projectPath = resolveMemoryProjectPath(options.project ?? process.cwd());
      const result = await finishMemory(projectPath, name, options.attach, {
        source: options.source,
        updateFile: options.updateFile,
        outcome: options.outcome,
        useGitignore: options.gitignore,
      });
      if (options.json) {
        process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
        return;
      }
      console.log(pc.green(`Attach run ${result.attachId} finished.`));
      console.log(`Outcome: ${result.run.status}`);
      console.log(`Revision: ${result.revision?.id ?? "unchanged"}`);
    } catch (err: any) {
      return fail("HANDOFF_ERROR", err);
    }
  });

memoryCommand
  .command("abandon")
  .argument("[name]", "Memory name; defaults to the active memory")
  .requiredOption("--attach <id>", "Attach run identifier returned by memory attach")
  .requiredOption("--reason <text>", "Why the claimed run cannot be completed")
  .option("--project <path>", "Project directory")
  .option("--json", "Print a machine-readable abandon result")
  .description("Release an unfinished attach claim without changing memory state")
  .action(async (name, options) => {
    try {
      const projectPath = resolveMemoryProjectPath(options.project ?? process.cwd());
      const run = await abandonMemory(projectPath, name, options.attach, options.reason);
      if (options.json) {
        process.stdout.write(`${JSON.stringify({ schemaVersion: 2, run }, null, 2)}\n`);
        return;
      }
      console.log(pc.yellow(`Attach run ${run.id} abandoned.`));
      console.log(`Reason: ${run.history.at(-1)?.reason}`);
    } catch (err: any) {
      return fail("HANDOFF_ERROR", err);
    }
  });

memoryCommand
  .command("recall")
  .argument("[name]", "Memory name; defaults to the active memory")
  .requiredOption("--query <text>", "Phrase, file path, decision, or topic to recall")
  .option("--limit <n>", "Maximum results", "10")
  .option("--project <path>", "Project directory")
  .option("--json", "Print machine-readable recall results")
  .description("Search durable knowledge and sanitized archived messages locally")
  .action(async (name, options) => {
    try {
      const projectPath = resolveMemoryProjectPath(options.project ?? process.cwd());
      const limit = Number(options.limit);
      const result = await recallMemory(projectPath, name, options.query, limit);
      if (options.json) {
        process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
        return;
      }
      process.stdout.write(`${formatMemoryRecall(result)}\n`);
    } catch (err: any) {
      return fail("HISTORY_ERROR", err);
    }
  });

memoryCommand
  .command("resume")
  .argument("[name]", "Memory name; defaults to the active memory")
  .requiredOption("--to <agent>", "Target CLI: codex | claude | grok")
  .option("--source <target>", "Exact source session to synchronize before attach")
  .option("--no-sync", "Load the frozen latest revision without synchronizing")
  .option("--project <path>", "Project directory")
  .option("--json", "Print a machine-readable resume contract")
  .description("Compatibility alias for memory attach")
  .action(async (name, options) => {
    try {
      const targetCli = parseContinuationAgent(options.to);
      const projectPath = resolveMemoryProjectPath(options.project ?? process.cwd());
      const result = await resumeMemory(projectPath, name, targetCli, {
        source: options.source,
        noSync: options.sync === false,
      });
      if (options.json) {
        process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
        return;
      }
      console.log(pc.bold(`Attach project memory '${result.memory}' in ${result.targetCli}`));
      console.log(`Readiness: ${result.readiness.level}`);
      console.log(`Execution mode: ${result.executionMode}`);
      console.log(`Automatic resume: ${result.resumeAllowed ? "allowed" : "withheld"}`);
      console.log(`Repository drift: ${result.drift.detected ? result.drift.categories.join(", ") : "none"}`);
      console.log(
        `Initial context + prompt: ${result.contextBudget.combinedBytes}/${result.contextBudget.maxBytes} bytes`
      );
      if (!result.contextBudget.withinBudget) {
        console.log(
          pc.yellow("Warning: this older memory revision exceeds the current initial-context budget; inspect it before loading.")
        );
      }
      console.log("");
      console.log(result.suggestedCommand);
    } catch (err: any) {
      return fail("HANDOFF_ERROR", err);
    }
  });

program
  .command("doctor")
  .description("Validate environment, Codex availability, and .gitignore safety")
  .action(async () => {
    const code = await runDoctor();
    process.exitCode = code;
  });

program
  .command("quickstart")
  .description("Guided read-only onboarding for first-time users")
  .action(async () => {
    try {
      await runQuickstart(process.cwd());
    } catch (error: unknown) {
      fail("PROJECT_ERROR", error);
    }
  });

const hooksCommand = program
  .command("hooks")
  .description("Install native agent lifecycle hooks for automatic memory checkpoints and session-start context");

async function resolveHookAgents(agentOption: string | undefined): Promise<HookAgent[]> {
  const agent = agentOption ? String(agentOption).toLowerCase() : undefined;
  if (agent && !["codex", "claude", "grok", "all"].includes(agent)) {
    throw new Error(`Unsupported --agent '${agentOption}'. Use codex, claude, grok, or all.`);
  }
  if (agent && agent !== "all") return [agent as HookAgent];
  if (agent === "all") return HOOK_AGENTS;
  // No --agent: install for whichever supported agents exist on this machine.
  const detected: HookAgent[] = [];
  for (const candidate of HOOK_AGENTS) {
    if (await commandAvailable(candidate)) detected.push(candidate);
  }
  if (detected.length === 0) {
    throw new Error(
      "No supported coding agent (claude, codex, grok) was found on PATH. Re-run with an explicit --agent."
    );
  }
  return detected;
}

hooksCommand
  .command("install")
  .option("--agent <agent>", "Target agent: codex | claude | grok | all (default: detect installed agents)")
  .option("--project <path>", "Project directory")
  .option("--shared", "Claude: write committable .claude/settings.json instead of settings.local.json")
  .option("--session-start", "Grok: also install a SessionStart bootstrap hook")
  .option("--force", "Replace differing hamma-managed hook entries")
  .option("--json", "Print a machine-readable install result")
  .description("Write Hamma lifecycle hooks into this project's agent settings files")
  .action(async (options) => {
    try {
      const projectPath = resolveMemoryProjectPath(options.project ?? process.cwd());
      const agents = await resolveHookAgents(options.agent);
      const results: HookInstallResult[] = [];
      for (const agent of agents) {
        results.push(await installHooks({
          agent,
          projectPath,
          force: Boolean(options.force),
          shared: Boolean(options.shared),
          sessionStart: Boolean(options.sessionStart),
        }));
      }
      if (options.json) {
        const payload = results.length === 1 ? results[0] : { installs: results };
        process.stdout.write(`${JSON.stringify(payload, null, 2)}\n`);
        return;
      }
      for (const result of results) {
        const events = [...result.installed, ...result.replaced];
        const relative = path.relative(projectPath, result.settingsPath);
        if (events.length > 0) {
          console.log(pc.green(`✓ ${result.agent} hooks installed: ${relative} (${events.join(", ")})`));
        } else {
          console.log(pc.dim(`✓ ${result.agent} hooks already current: ${relative}`));
        }
        for (const warning of result.warnings) console.log(pc.yellow(`  Warning: ${warning}`));
      }
      console.log("");
      console.log("Hooks stay no-ops until memory is enabled for this project (first `hamma save` or `hamma switch`).");
      if (results.some((result) => result.agent !== "claude")) {
        console.log("Codex and Grok project hooks require project trust in those agents.");
      }
      if (results.some((result) => result.agent === "codex")) {
        console.log("For reliable Codex exit checkpoints, trust these commands with `/hooks`, then launch with `hamma codex`.");
      }
    } catch (err: any) {
      return fail("INSTALL_ERROR", err);
    }
  });

hooksCommand
  .command("uninstall")
  .option("--agent <agent>", "Target agent: codex | claude | grok | all (default: all)")
  .option("--project <path>", "Project directory")
  .option("--shared", "Claude: target .claude/settings.json instead of settings.local.json")
  .option("--json", "Print a machine-readable uninstall result")
  .description("Remove Hamma-managed hook entries from this project's agent settings files")
  .action(async (options) => {
    try {
      const projectPath = resolveMemoryProjectPath(options.project ?? process.cwd());
      const agent = options.agent ? String(options.agent).toLowerCase() : "all";
      if (!["codex", "claude", "grok", "all"].includes(agent)) {
        throw new Error(`Unsupported --agent '${options.agent}'. Use codex, claude, grok, or all.`);
      }
      const agents: HookAgent[] = agent === "all" ? HOOK_AGENTS : [agent as HookAgent];
      const results: HookUninstallResult[] = [];
      for (const target of agents) {
        results.push(await uninstallHooks({
          agent: target,
          projectPath,
          shared: Boolean(options.shared),
        }));
      }
      if (options.json) {
        const payload = results.length === 1 ? results[0] : { uninstalls: results };
        process.stdout.write(`${JSON.stringify(payload, null, 2)}\n`);
        return;
      }
      for (const result of results) {
        const relative = path.relative(projectPath, result.settingsPath);
        if (result.removed.length > 0) {
          console.log(pc.green(`✓ ${result.agent} hooks removed: ${relative} (${result.removed.join(", ")})${result.fileDeleted ? " — file deleted" : ""}`));
        } else {
          console.log(pc.dim(`✓ ${result.agent}: no Hamma hooks found in ${relative}`));
        }
      }
    } catch (err: any) {
      return fail("INSTALL_ERROR", err);
    }
  });

const skillCommand = program
  .command("skill")
  .description("Install and manage HammaDev agent skills");

skillCommand
  .command("install")
  .option("--agent <agent>", "Target agent: codex | claude | grok | both", "both")
  .option("--force", "Replace an existing hamma-handoff skill")
  .option("--codex-home <path>", "Override the Codex home directory")
  .option("--claude-home <path>", "Override the Claude home directory")
  .option("--grok-home <path>", "Override the Grok home directory")
  .option("--json", "Print only a machine-readable install result")
  .description("Install the packaged Hamma skills (handoff, snap, resume) for supported agents. For grok this installs universal artifacts (skill install for grok may place in ~/.grok/skills or be used directly via handoff suggested command).")
  .action(async (options) => {
    const agent = String(options.agent).toLowerCase();
    if (!["codex", "claude", "grok", "both"].includes(agent)) {
      return fail(
        "INSTALL_ERROR",
        new Error(`Unsupported --agent '${options.agent}'. Use codex, claude, grok, or both.`)
      );
    }
    const targets: SkillAgent[] = agent === "both" ? ["codex", "claude"] : [agent as SkillAgent];

    try {
      const results: SkillInstallResult[] = [];
      for (const target of targets) {
        results.push(
          ...(await installAllSkills({
            agent: target,
            home: target === "codex" ? options.codexHome : (target === "grok" ? options.grokHome : options.claudeHome),
            force: Boolean(options.force)
          }))
        );
      }

      if (options.json) {
        const payload = results.length === 1 ? results[0] : { installs: results };
        process.stdout.write(`${JSON.stringify(payload, null, 2)}\n`);
        return;
      }

      for (const result of results) {
        console.log(pc.green(`${result.skillName} installed for ${result.agent} at:`));
        console.log(pc.dim(result.destination));
      }
      console.log("");
      console.log(
        pc.bold(
          `Restart ${targets.map((t) => (t === "codex" ? "Codex" : "Claude Code")).join(" and ")} to pick up the skill.`
        )
      );
    } catch (err: any) {
      return fail("INSTALL_ERROR", err);
    }
  });

program.parseAsync();
