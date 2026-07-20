import { execFile } from "node:child_process";
import path from "node:path";
import { promisify } from "node:util";
import pc from "picocolors";
import { getProjectStatus, ProjectStatus } from "./project-status.js";
import { isNodeVersionSupported, MIN_NODE_VERSION } from "./runtime.js";

const execFileAsync = promisify(execFile);

async function commandAvailable(command: string): Promise<boolean> {
  try {
    await execFileAsync(command, ["--version"], {
      encoding: "utf8",
      timeout: 5_000
    });
    return true;
  } catch (error: any) {
    return error.code !== "ENOENT";
  }
}

function indicator(ok: boolean): string {
  return ok ? pc.green("✔") : pc.yellow("!");
}

function sessionSummary(total: number, project: number): string {
  if (total === 0) return "none found";
  if (project === 0) return `${total} total, none match this project`;
  return `${total} total, ${project} for this project`;
}

function missingItems(
  status: ProjectStatus,
  codexInstalled: boolean,
  claudeInstalled: boolean,
  grokInstalled: boolean
): string[] {
  const missing: string[] = [];
  if (!codexInstalled && !claudeInstalled && !grokInstalled) {
    missing.push("Install at least one supported coding agent: Codex, Claude Code, or Grok.");
  }
  if (!status.isGitRepo) {
    missing.push("This directory is not a Git repository; run quickstart from the project you want to hand off.");
  }
  if (
    status.codexProjectSessionCount === 0 &&
    status.claudeProjectSessionCount === 0 &&
    status.grokProjectSessionCount === 0
  ) {
    missing.push("No sessions from supported agents (codex, claude, grok) match this project; start an agent session from this directory first.");
  }
  if (status.isGitRepo && status.hammaIgnored === false) {
    missing.push(".hamma/ is not ignored; add '.hamma/' to .gitignore before sharing the repository.");
  }
  return missing;
}

function nextCommands(
  status: ProjectStatus,
  codexInstalled: boolean,
  claudeInstalled: boolean,
  grokInstalled: boolean
): string[] {
  const project = JSON.stringify(status.projectPath);
  if (status.memory.activeName) {
    if (status.memory.openAttachId) {
      return [
        `hamma save --project ${project}`,
        `# When finished: hamma done --project ${project}`,
      ];
    }
    const target = claudeInstalled ? "claude" : codexInstalled ? "codex" : grokInstalled ? "grok" : "codex";
    return [
      `hamma switch ${target} --project ${project}`,
      "# Hamma saves, prepares context, and opens the target agent.",
    ];
  }
  if (status.codexProjectSessionCount > 0 && (claudeInstalled || grokInstalled)) {
    const target = claudeInstalled ? "claude" : "grok";
    return [
      `hamma save --agent codex --project ${project}`,
      `hamma switch ${target} --project ${project}`,
    ];
  }
  if (status.claudeProjectSessionCount > 0 && (codexInstalled || grokInstalled)) {
    const target = codexInstalled ? "codex" : "grok";
    return [
      `hamma save --agent claude --project ${project}`,
      `hamma switch ${target} --project ${project}`,
    ];
  }
  if (status.grokProjectSessionCount > 0 && (claudeInstalled || codexInstalled)) {
    const target = claudeInstalled ? "claude" : "codex";
    return [
      `hamma save --agent grok --project ${project}`,
      `hamma switch ${target} --project ${project}`,
    ];
  }
  if (status.codexProjectSessionCount > 0) {
    return [`hamma save --agent codex --project ${project}`];
  }
  if (status.claudeProjectSessionCount > 0) {
    return [`hamma save --agent claude --project ${project}`];
  }
  if (status.grokProjectSessionCount > 0) {
    return [`hamma save --agent grok --project ${project}`];
  }

  const commands: string[] = [];
  if (!codexInstalled && !claudeInstalled && !grokInstalled) {
    commands.push("# Install Codex, Claude Code, or Grok, then run `hamma save` from your project.");
  }
  if (status.isGitRepo && status.hammaIgnored === false) {
    commands.push("printf '\n.hamma/\n' >> .gitignore");
  }
  if (
    status.codexProjectSessionCount === 0 &&
    status.claudeProjectSessionCount === 0 &&
    status.grokProjectSessionCount === 0
  ) {
    commands.push("# Start a supported agent from this project, then run: hamma save");
  }
  return commands.length > 0 ? commands : ["hamma status"];
}

export async function runQuickstart(projectDir: string): Promise<void> {
  const projectPath = path.resolve(projectDir);
  const [status, codexInstalled, claudeInstalled, grokInstalled] = await Promise.all([
    getProjectStatus(projectPath),
    commandAvailable("codex"),
    commandAvailable("claude"),
    commandAvailable("grok"),
  ]);
  const nodeRaw = process.versions.node;
  const nodeOk = isNodeVersionSupported(nodeRaw);
  const gitAvailable = status.gitStatus !== "unavailable";
  const missing = missingItems(status, codexInstalled, claudeInstalled, grokInstalled);
  if (!gitAvailable) missing.unshift("Git is not installed or not on PATH.");
  if (!nodeOk) {
    missing.unshift(`Node.js ${MIN_NODE_VERSION}+ is required; detected ${nodeRaw}.`);
  }

  console.log(pc.bold("HammaDev quickstart\n"));
  console.log(`Project:\n  ${projectPath}\n`);
  console.log("Readiness:");
  console.log(`  ${indicator(nodeOk)} Node.js: ${nodeRaw} (requires ${MIN_NODE_VERSION}+)`);
  console.log(`  ${indicator(gitAvailable)} Git: ${gitAvailable ? "available" : "not found on PATH"}`);
  console.log(`  ${indicator(status.isGitRepo)} Git repository: ${status.isGitRepo ? "yes" : "no"}`);
  console.log(`  ${indicator(codexInstalled)} Codex CLI: ${codexInstalled ? "installed" : "not found"}`);
  console.log(`  ${indicator(status.codexProjectSessionCount > 0)} Codex sessions: ${sessionSummary(status.codexSessionCount, status.codexProjectSessionCount)}`);
  console.log(`  ${indicator(claudeInstalled)} Claude Code: ${claudeInstalled ? "installed" : "not found"}`);
  console.log(`  ${indicator(status.claudeProjectSessionCount > 0)} Claude sessions: ${sessionSummary(status.claudeSessionCount, status.claudeProjectSessionCount)}`);
  console.log(`  ${indicator(grokInstalled)} Grok: ${grokInstalled ? "installed" : "not found"}`);
  console.log(`  ${indicator(status.grokProjectSessionCount > 0)} Grok sessions: ${sessionSummary(status.grokSessionCount, status.grokProjectSessionCount)}`);
  const ignored = status.hammaIgnored === null
    ? "not applicable (not a Git repository)"
    : status.hammaIgnored
      ? "yes"
      : "no";
  console.log(`  ${indicator(status.hammaIgnored !== false)} .hamma/ ignored: ${ignored}`);
  console.log(`  ${pc.green("•")} Existing handoffs: ${status.handoffCount}\n`);
  console.log(`  ${pc.green("•")} Repository memory: ${status.memory.activeName ? `${status.memory.activeName} (${status.memory.revisionCount} revisions, ${status.memory.outcome ?? "waiting"}${status.memory.openAttachId ? `, claimed by ${status.memory.openAttachTarget}` : ""})` : "not enabled; first explicit sync or attach creates default"}\n`);

  console.log("What is missing:");
  if (missing.length === 0) console.log("  Nothing required. This project is ready for `hamma save` or `hamma switch`.");
  else for (const item of missing) console.log(`  - ${item}`);

  console.log("\nRun next:");
  for (const command of nextCommands(status, codexInstalled, claudeInstalled, grokInstalled)) {
    console.log(`  ${command}`);
  }
}
