#!/usr/bin/env node
import { Command } from "commander";
import pc from "picocolors";
import { CodexAdapter } from "./adapters/codex/index.js";
import { createHandoff } from "./core/handoff.js";
import { runDoctor } from "./core/doctor.js";

const program = new Command();

program
  .name("hamma")
  .description("Shared memory and handoff layer for agentic coding CLIs")
  .version("0.1.0-alpha");

program
  .command("list")
  .argument("<source>", "source CLI: codex")
  .description("List sessions from a source CLI")
  .action(async (source) => {
    if (source !== "codex") {
      console.error(pc.red(`Error: Unsupported target source '${source}'. Only 'codex' is supported.`));
      process.exit(1);
    }

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
  });

program
  .command("inspect")
  .argument("<target>", "codex:last | codex:<conversationId> | path to rollout-*.jsonl")
  .option("--summary", "Print a summarized version of the session")
  .description("Inspect one session")
  .action(async (target, options) => {
    let rolloutPath: string;
    try {
      rolloutPath = await CodexAdapter.resolve(target);
    } catch (err: any) {
      console.error(pc.red(`Error: ${err.message}`));
      process.exit(1);
    }

    try {
      const session = await CodexAdapter.inspect(rolloutPath);

      if (options.summary) {
        const truncate = (s: string | undefined, max: number) => {
          if (!s) return s;
          return s.length > max ? s.slice(0, max) + "..." : s;
        };

        const summary = {
          meta: session.meta,
          messageCount: session.messages.length,
          shellCommandCount: session.shellCommands.length,
          parserWarningsCount: session.parserWarnings.length,
          redactionCount: session.security.redactionCount,
          firstMessages: session.messages.slice(0, 5).map(m => ({
            ...m,
            content: truncate(m.content, 300)
          })),
          lastMessages: session.messages.slice(-5).map(m => ({
            ...m,
            content: truncate(m.content, 300)
          })),
          lastShellCommands: session.shellCommands.slice(-10).map(c => ({
            ...c,
            command: truncate(c.command, 200),
            output: c.output !== undefined ? "<omitted>" : undefined
          }))
        };
        console.log(JSON.stringify(summary, null, 2));
      } else {
        console.log(JSON.stringify(session, null, 2));
      }
    } catch (err: any) {
      console.error(pc.red(`Error inspecting session: ${err.message}`));
      process.exit(1);
    }
  });

program
  .command("handoff")
  .argument("<target>", "codex:last | codex:<conversationId> | path to rollout-*.jsonl")
  .requiredOption("--to <agent>", "Target CLI (e.g. claude)")
  .option("--no-gitignore", "Do not modify .gitignore")
  .description("Create a handoff package for another agent")
  .action(async (target, options) => {
    let rolloutPath: string;
    try {
      rolloutPath = await CodexAdapter.resolve(target);
    } catch (err: any) {
      console.error(pc.red(`Error: ${err.message}`));
      process.exit(1);
    }

    try {
      const session = await CodexAdapter.inspect(rolloutPath);

      await createHandoff(session, options.to, options.gitignore);
    } catch (err: any) {
      console.error(pc.red(`Error processing handoff: ${err.message}`));
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
