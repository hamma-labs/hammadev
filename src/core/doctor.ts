import fs from "node:fs/promises";
import path from "node:path";
import { execSync } from "node:child_process";
import pc from "picocolors";
import { CodexAdapter } from "../adapters/codex/index.js";
import { defaultCodexHome } from "../adapters/codex/paths.js";
import { isNodeVersionSupported, MIN_NODE_VERSION } from "./runtime.js";

type CheckStatus = "pass" | "warn" | "fail";

interface Check {
  name: string;
  status: CheckStatus;
  message: string;
}

function marker(status: CheckStatus): string {
  if (status === "pass") return pc.green("✔");
  if (status === "warn") return pc.yellow("!");
  return pc.red("✖");
}

async function pathExists(p: string): Promise<boolean> {
  try {
    await fs.access(p);
    return true;
  } catch {
    return false;
  }
}

function checkNode(): Check {
  const raw = process.versions.node;
  if (!isNodeVersionSupported(raw)) {
    return {
      name: "Node.js version",
      status: "fail",
      message: `Node ${raw} detected. HammaDev requires Node ${MIN_NODE_VERSION}+.`,
    };
  }
  return { name: "Node.js version", status: "pass", message: `Node ${raw}` };
}

function checkGit(): Check {
  try {
    const out = execSync("git --version", {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    }).trim();
    return { name: "git availability", status: "pass", message: out };
  } catch (err: any) {
    const detail = err.message?.split("\n")[0] ?? "unknown error";
    return {
      name: "git availability",
      status: "fail",
      message: `git not found on PATH (${detail}). Handoff repo-state section will be empty.`,
    };
  }
}

async function checkCodexSessions(): Promise<{ check: Check; latestPath?: string }> {
  const home = defaultCodexHome();
  if (!(await pathExists(home))) {
    return {
      check: {
        name: "Codex sessions",
        status: "warn",
        message: `Codex home not found at ${home}. Install Codex CLI and run a session first.`,
      },
    };
  }

  const sessions = await CodexAdapter.list();
  if (sessions.length === 0) {
    return {
      check: {
        name: "Codex sessions",
        status: "warn",
        message: `No rollout-*.jsonl files under ${home}/sessions.`,
      },
    };
  }

  const latest = sessions[0];
  return {
    check: {
      name: "Codex sessions",
      status: "pass",
      message: `${sessions.length} session(s) found. Newest: ${latest.startedAt ?? "unknown-time"} (${latest.conversationId}).`,
    },
    latestPath: latest.path,
  };
}

async function checkProjectPath(latestPath?: string): Promise<{ check: Check; projectPath?: string }> {
  if (!latestPath) {
    return {
      check: {
        name: "projectPath detection",
        status: "warn",
        message: "Skipped — no Codex session available to parse.",
      },
    };
  }

  try {
    const session = await CodexAdapter.inspect(latestPath);
    const projectPath = session.meta.projectPath;

    if (!projectPath) {
      return {
        check: {
          name: "projectPath detection",
          status: "fail",
          message: "Latest session has no projectPath. Handoff will fail with 'source session has no projectPath'.",
        },
      };
    }

    if (!(await pathExists(projectPath))) {
      return {
        check: {
          name: "projectPath detection",
          status: "warn",
          message: `Detected projectPath ${projectPath} does not exist on this machine.`,
        },
        projectPath,
      };
    }

    return {
      check: {
        name: "projectPath detection",
        status: "pass",
        message: `Detected: ${projectPath}`,
      },
      projectPath,
    };
  } catch (err: any) {
    return {
      check: {
        name: "projectPath detection",
        status: "fail",
        message: `Failed to parse latest session: ${err.message}`,
      },
    };
  }
}

async function checkGitignoreSafety(projectPath?: string): Promise<Check> {
  const targetDir = projectPath ?? process.cwd();
  const label = projectPath ? `source project ${projectPath}` : `current directory ${targetDir}`;

  const isGitRepo = await pathExists(path.join(targetDir, ".git"));
  if (!isGitRepo) {
    return {
      name: ".gitignore safety",
      status: "pass",
      message: `${label} is not a git repo — nothing to ignore.`,
    };
  }

  const gitignorePath = path.join(targetDir, ".gitignore");
  if (!(await pathExists(gitignorePath))) {
    return {
      name: ".gitignore safety",
      status: "warn",
      message: `No .gitignore in ${label}. Handoff will create one with \`.hamma/\`.`,
    };
  }

  const content = await fs.readFile(gitignorePath, "utf8");
  if (!content.includes(".hamma/")) {
    return {
      name: ".gitignore safety",
      status: "warn",
      message: `\`.hamma/\` is not in .gitignore of ${label}. Handoff will append it (or pass --no-gitignore to skip).`,
    };
  }

  return {
    name: ".gitignore safety",
    status: "pass",
    message: `\`.hamma/\` is ignored in ${label}.`,
  };
}

export async function runDoctor(): Promise<number> {
  const checks: Check[] = [];

  checks.push(checkNode());
  checks.push(checkGit());

  const { check: codexCheck, latestPath } = await checkCodexSessions();
  checks.push(codexCheck);

  const { check: projectPathCheck, projectPath } = await checkProjectPath(latestPath);
  checks.push(projectPathCheck);

  checks.push(await checkGitignoreSafety(projectPath));

  console.log(pc.bold("hamma doctor\n"));
  for (const c of checks) {
    console.log(`${marker(c.status)} ${pc.bold(c.name)} — ${c.message}`);
  }

  const passed = checks.filter((c) => c.status === "pass").length;
  const warned = checks.filter((c) => c.status === "warn").length;
  const failed = checks.filter((c) => c.status === "fail").length;

  console.log("");
  console.log(`${pc.green(`${passed} pass`)}, ${pc.yellow(`${warned} warn`)}, ${pc.red(`${failed} fail`)}`);

  return failed > 0 ? 1 : 0;
}
