#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Command } from "commander";
import pc from "picocolors";
import { CodexAdapter } from "./adapters/codex/index.js";
import { ClaudeAdapter } from "./adapters/claude/index.js";
import { ClaudeShapeReport } from "./adapters/claude/shape.js";
import { HammaSession } from "./core/schema.js";
import { createHandoff } from "./core/handoff.js";
import { formatHandoffLog, listHandoffs, readHandoff } from "./core/history.js";
import { formatProjectStatus, getProjectStatus } from "./core/project-status.js";
import { runDoctor } from "./core/doctor.js";
import { installAllSkills, SkillAgent, SkillInstallResult } from "./core/skill-install.js";
import { loadSession, resolveSessionTarget } from "./session-loader.js";
import { runQuickstart } from "./core/quickstart.js";
import { ErrorCategory, errorMessage, formatCliError } from "./core/errors.js";
import { AsyncStructuredLogger } from "./core/logger.js";

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
  .description("Shared memory and handoff layer for agentic coding CLIs")
  .version(pkg.version)
  .action(async () => {
    try {
      await runQuickstart(process.cwd());
    } catch (error: unknown) {
      fail("PROJECT_ERROR", error);
    }
  });

program
  .command("list")
  .argument("<source>", "source CLI: codex | claude")
  .option("--project <path>", "Filter and rank Claude sessions for a project")
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

    return fail(
      "CLI_ERROR",
      new Error(`Unsupported source '${source}'. Supported: 'codex', 'claude'.`)
    );
  });

program
  .command("inspect")
  .argument(
    "<target>",
    "codex:last | codex:<conversationId> | claude:last | claude:<sessionId> | session JSONL path"
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
    "codex:last | codex:project | codex:current | codex:previous | codex:<conversationId> | claude:last | claude:project | claude:current | claude:previous | claude:<sessionId> | session JSONL path"
  )
  .requiredOption("--to <agent>", "Target CLI (e.g. claude or codex)")
  .option("--project <path>", "Project used to resolve claude/codex :project, :current, or :previous")
  .option("--json", "Print only a machine-readable handoff result")
  .option("--no-gitignore", "Do not modify .gitignore")
  .description("Create a handoff package for another agent")
  .action(async (target, options) => {
    try {
      const PROJECT_SCOPED = new Set([
        "claude:project", "claude:current", "claude:previous",
        "codex:project", "codex:current", "codex:previous",
      ]);
      const isProjectTarget = PROJECT_SCOPED.has(target);
      const projectPath = options.project
        ? path.resolve(options.project)
        : isProjectTarget
          ? process.cwd()
          : undefined;
      const session = await loadSession(target, { projectPath });
      if (isProjectTarget && projectPath) {
        session.meta.projectPath = projectPath;
      }
      const result = await createHandoff(
        session,
        options.to,
        options.gitignore,
        { quiet: Boolean(options.json) }
      );
      if (options.json) {
        process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
      }
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
  .description("Print a local handoff brief")
  .action(async (taskId) => {
    try {
      const markdown = await readHandoff(process.cwd(), taskId);
      process.stdout.write(markdown.endsWith("\n") ? markdown : markdown + "\n");
    } catch (err: any) {
      return fail("HISTORY_ERROR", err);
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

const skillCommand = program
  .command("skill")
  .description("Install and manage HammaDev agent skills");

skillCommand
  .command("install")
  .option("--agent <agent>", "Target agent: codex | claude | both", "both")
  .option("--force", "Replace an existing hamma-handoff skill")
  .option("--codex-home <path>", "Override the Codex home directory")
  .option("--claude-home <path>", "Override the Claude home directory")
  .option("--json", "Print only a machine-readable install result")
  .description("Install the packaged Hamma skills (handoff, snap, resume) for Codex and/or Claude Code")
  .action(async (options) => {
    const agent = String(options.agent).toLowerCase();
    if (!["codex", "claude", "both"].includes(agent)) {
      return fail(
        "INSTALL_ERROR",
        new Error(`Unsupported --agent '${options.agent}'. Use codex, claude, or both.`)
      );
    }
    const targets: SkillAgent[] = agent === "both" ? ["codex", "claude"] : [agent as SkillAgent];

    try {
      const results: SkillInstallResult[] = [];
      for (const target of targets) {
        results.push(
          ...(await installAllSkills({
            agent: target,
            home: target === "codex" ? options.codexHome : options.claudeHome,
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
