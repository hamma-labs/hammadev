#!/usr/bin/env node
import path from "node:path";
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
import { loadSession, resolveSessionTarget } from "./session-loader.js";

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

const program = new Command();

program
  .name("hamma")
  .description("Shared memory and handoff layer for agentic coding CLIs")
  .version("0.1.0-alpha.0");

program
  .command("list")
  .argument("<source>", "source CLI: codex | claude")
  .description("List sessions from a source CLI")
  .action(async (source) => {
    if (source === "codex") {
      const sessions = await CodexAdapter.list();

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
      const sessions = await ClaudeAdapter.list();

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

    console.error(
      pc.red(`Error: Unsupported source '${source}'. Supported: 'codex', 'claude'.`)
    );
    process.exit(1);
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
        console.error(
          pc.red(`Error inspecting Claude session shape: ${err.message}`)
        );
        process.exit(1);
      }
    }

    try {
      const session = await loadSession(target);
      console.log(renderSession(session, Boolean(options.summary)));
    } catch (err: any) {
      console.error(pc.red(`Error inspecting session: ${err.message}`));
      process.exit(1);
    }
  });

program
  .command("handoff")
  .argument(
    "<target>",
    "codex:last | codex:<conversationId> | claude:last | claude:<sessionId> | session JSONL path"
  )
  .requiredOption("--to <agent>", "Target CLI (e.g. claude or codex)")
  .option("--no-gitignore", "Do not modify .gitignore")
  .description("Create a handoff package for another agent")
  .action(async (target, options) => {
    try {
      const session = await loadSession(target);
      await createHandoff(session, options.to, options.gitignore);
    } catch (err: any) {
      console.error(pc.red(`Error processing handoff: ${err.message}`));
      process.exit(1);
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
      console.error(pc.red(`Error reading project status: ${err.message}`));
      process.exit(1);
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
      console.error(pc.red(`Error reading handoff history: ${err.message}`));
      process.exit(1);
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
      console.error(pc.red(`Error reading handoff: ${err.message}`));
      process.exit(1);
    }
  });

program
  .command("doctor")
  .description("Validate environment, Codex availability, and .gitignore safety")
  .action(async () => {
    const code = await runDoctor();
    process.exit(code);
  });

program.parseAsync();
