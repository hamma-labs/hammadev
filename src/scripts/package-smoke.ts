import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import {
  INITIAL_CONTEXT_MAX_BYTES,
  TOOL_HISTORY_ARCHIVE_MAX_BYTES,
} from "../core/artifact-policy.js";
import { verifyCommandSurface } from "./command-surface.js";
import { runNpm } from "./npm-cli.js";

const execFileAsync = promisify(execFile);
const ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../.."
);

interface PackResult {
  filename: string;
  size: number;
  files: Array<{ path: string }>;
}

interface ContinueResult {
  preflight: {
    outcome: string;
    shouldCreateHandoff: boolean;
  };
  handoff: null | {
    handoffPath: string;
    statePath: string;
    suggestedCommand: string;
    contextBudget: {
      bytes: number;
      maxBytes: number;
      withinBudget: boolean;
    };
  };
}

interface SimpleSaveSmokeResult {
  operation: string;
  memory: string;
  source: { agent: string; sessionId: string };
  outcome?: string;
}

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

async function git(projectPath: string, args: string[]): Promise<void> {
  await execFileAsync("git", ["-C", projectPath, ...args]);
}

async function writeClaudeSession(
  sessionPath: string,
  projectPath: string,
  completed: boolean
): Promise<void> {
  const sessionId = "aaaaaaaa-1111-4aaa-8aaa-aaaaaaaaaaaa";
  const records = [
    {
      type: "user",
      sessionId,
      cwd: projectPath,
      timestamp: "2026-07-19T10:00:00.000Z",
      message: {
        role: "user",
        content: "Automate synthetic npm publishing and verify it.",
      },
    },
    {
      type: "assistant",
      sessionId,
      timestamp: "2026-07-19T10:01:00.000Z",
      message: {
        role: "assistant",
        content: completed
          ? "npm publishing is now fully automated and verified. All tests passed."
          : "Implementation is in progress. Next action: add the remaining verification coverage.",
      },
    },
  ];
  await fs.writeFile(
    sessionPath,
    `${records.map((record) => JSON.stringify(record)).join("\n")}\n`,
    "utf8"
  );
}

async function runInstalled(
  executable: string,
  executableArgs: string[],
  args: string[],
  projectPath: string,
  fakeHome: string
): Promise<string> {
  const result = await execFileAsync(executable, [...executableArgs, ...args], {
    cwd: projectPath,
    env: {
      ...process.env,
      HOME: fakeHome,
      USERPROFILE: fakeHome,
      CLAUDE_HOME: path.join(fakeHome, ".claude"),
    },
    maxBuffer: 4 * 1024 * 1024,
  });
  return result.stdout;
}

async function main(): Promise<void> {
  const temporaryRoot = await fs.mkdtemp(
    path.join(os.tmpdir(), "hamma-package-smoke-")
  );
  try {
    const packDirectory = path.join(temporaryRoot, "pack");
    const installDirectory = path.join(temporaryRoot, "install");
    const projectPath = path.join(temporaryRoot, "project");
    const fakeHome = path.join(temporaryRoot, "home");
    const npmCache = path.join(temporaryRoot, "npm-cache");
    await Promise.all([
      fs.mkdir(packDirectory),
      fs.mkdir(installDirectory),
      fs.mkdir(projectPath),
      fs.mkdir(fakeHome),
    ]);

    const npmEnvironment = {
      ...process.env,
      npm_config_cache: npmCache,
      npm_config_update_notifier: "false",
    };
    const packed = await runNpm(
      ["pack", "--json", "--pack-destination", packDirectory],
      { cwd: ROOT, env: npmEnvironment, maxBuffer: 4 * 1024 * 1024 }
    );
    const [packResult] = JSON.parse(packed.stdout) as PackResult[];
    assert(packResult, "npm pack did not return package metadata.");
    const packedPaths = new Set(packResult.files.map((file) => file.path));
    assert(packedPaths.has("dist/cli.js"), "Packed artifact is missing dist/cli.js.");
    assert(
      packedPaths.has("product-contract.json"),
      "Packed artifact is missing product-contract.json."
    );
    assert(
      packedPaths.has("sbom.cdx.json"),
      "Packed artifact is missing sbom.cdx.json."
    );
    assert(
      packedPaths.has("SECURITY.md"),
      "Packed artifact is missing SECURITY.md."
    );
    assert(
      packedPaths.has("dist/adapters/codex/runtime.js"),
      "Packed artifact is missing the Codex runtime recovery module."
    );
    assert(
      packedPaths.has("dist/adapters/claude/runtime.js"),
      "Packed artifact is missing the Claude runtime recovery module."
    );
    assert(
      packedPaths.has("dist/adapters/grok/runtime.js"),
      "Packed artifact is missing the Grok runtime recovery module."
    );
    assert(
      packedPaths.has("skills/hamma-handoff/SKILL.md"),
      "Packed artifact is missing the handoff skill."
    );
    assert(
      ![...packedPaths].some((entry) =>
        entry === "AGENTS.md" ||
        entry === "reality.txt" ||
        entry.startsWith("docs/video-submission/") ||
        /\.(?:mp3|mp4|wav)$/i.test(entry) ||
        entry.startsWith("src/") ||
        entry.startsWith("tests/")
      ),
      "Packed artifact contains workspace-only source, generated media, tests, or local evidence."
    );
    assert(
      packResult.size < 10 * 1024 * 1024,
      `Packed artifact is unexpectedly large at ${packResult.size} bytes.`
    );

    const tarballPath = path.join(packDirectory, packResult.filename);
    await runNpm(
      [
        "install",
        "--ignore-scripts",
        "--no-audit",
        "--no-fund",
        "--prefix",
        installDirectory,
        tarballPath,
      ],
      { cwd: temporaryRoot, env: npmEnvironment, maxBuffer: 4 * 1024 * 1024 }
    );

    const installedCli = path.join(
      installDirectory,
      "node_modules",
      "hammadev",
      "dist",
      "cli.js"
    );
    const executable = process.execPath;
    const executableArgs = [installedCli];
    const packageJson = JSON.parse(
      await fs.readFile(path.join(ROOT, "package.json"), "utf8")
    ) as { version: string };
    const installedVersion = (await runInstalled(
      executable,
      executableArgs,
      ["--version"],
      temporaryRoot,
      fakeHome
    )).trim();
    assert(
      installedVersion === packageJson.version,
      `Installed CLI version ${installedVersion} does not match ${packageJson.version}.`
    );
    await verifyCommandSurface(executable, undefined, executableArgs);
    const installedCodexHelp = await runInstalled(
      executable,
      executableArgs,
      ["codex", "--help"],
      temporaryRoot,
      fakeHome
    );
    assert(
      installedCodexHelp.includes("auto-saved when you exit") &&
        installedCodexHelp.includes("--codex-bin <command>"),
      "Installed package does not expose the reliable Codex launcher."
    );

    await git(projectPath, ["init", "-q"]);
    await git(projectPath, ["config", "user.email", "package-smoke@example.test"]);
    await git(projectPath, ["config", "user.name", "Package Smoke"]);
    await fs.writeFile(path.join(projectPath, "README.md"), "synthetic project\n");
    await git(projectPath, ["add", "README.md"]);
    await git(projectPath, ["commit", "-qm", "initial"]);

    const sessionId = "aaaaaaaa-1111-4aaa-8aaa-aaaaaaaaaaaa";
    const sessionPath = path.join(
      fakeHome,
      ".claude",
      "projects",
      "synthetic-project",
      `${sessionId}.jsonl`
    );
    await fs.mkdir(path.dirname(sessionPath), { recursive: true });

    await writeClaudeSession(sessionPath, projectPath, true);
    const explicitPreflightOutput = await runInstalled(
      executable,
      executableArgs,
      [
        "handoff",
        `claude:${sessionId}`,
        "--to",
        "claude",
        "--project",
        projectPath,
        "--preflight",
        "--compact-json",
        "--no-gitignore",
      ],
      projectPath,
      fakeHome
    );
    const explicitPreflight = JSON.parse(
      explicitPreflightOutput
    ) as ContinueResult;
    assert(
      explicitPreflight.preflight.outcome === "completed" &&
        !explicitPreflight.preflight.shouldCreateHandoff &&
        explicitPreflight.handoff === null,
      "Explicit completed-session preflight did not stop without a handoff."
    );
    assert(
      Buffer.byteLength(explicitPreflightOutput, "utf8") < 4096 &&
        explicitPreflightOutput.trim().split("\n").length === 1,
      "Explicit handoff preflight was not compact."
    );
    const completedOutput = await runInstalled(
      executable,
      executableArgs,
      [
        "continue",
        "--to",
        "codex",
        "--project",
        projectPath,
        "--compact-json",
        "--no-gitignore",
      ],
      projectPath,
      fakeHome
    );
    const completed = JSON.parse(completedOutput) as ContinueResult;
    assert(
      Buffer.byteLength(completedOutput, "utf8") < 4096,
      "Compact continuation response exceeded 4 KiB."
    );
    assert(
      completedOutput.trim().split("\n").length === 1,
      "Compact continuation response was not one line."
    );
    assert(completed.preflight.outcome === "completed", "Completed session was not recognized.");
    assert(!completed.preflight.shouldCreateHandoff, "Completed session was marked resumable.");
    assert(completed.handoff === null, "Completed session created a handoff artifact.");
    await fs.access(path.join(projectPath, ".hamma")).then(
      () => {
        throw new Error("Completed continuation created a .hamma directory.");
      },
      () => undefined
    );

    await writeClaudeSession(sessionPath, projectPath, false);
    const simpleSave = JSON.parse(await runInstalled(
      executable,
      executableArgs,
      ["save", "--agent", "claude", "--json", "--no-gitignore"],
      projectPath,
      fakeHome
    )) as SimpleSaveSmokeResult;
    assert(
      simpleSave.operation === "save" &&
        simpleSave.memory === "default" &&
        simpleSave.source.agent === "claude" &&
        simpleSave.source.sessionId === sessionId &&
        simpleSave.outcome === "actionable",
      "Installed simple save workflow did not capture the exact current session."
    );
    const actionable = JSON.parse(
      await runInstalled(
        executable,
        executableArgs,
        [
          "continue",
          "--to",
          "codex",
          "--project",
          projectPath,
          "--json",
          "--no-gitignore",
        ],
        projectPath,
        fakeHome
      )
    ) as ContinueResult;
    assert(actionable.preflight.outcome === "actionable", "Actionable session was not recognized.");
    assert(actionable.preflight.shouldCreateHandoff, "Actionable session was not resumable.");
    assert(actionable.handoff, "Actionable session did not create a handoff.");
    assert(
      actionable.handoff.contextBudget.withinBudget &&
        actionable.handoff.contextBudget.bytes <= INITIAL_CONTEXT_MAX_BYTES,
      "Generated initial context exceeded its hard limit."
    );
    assert(
      !actionable.handoff.suggestedCommand.includes("tool_history.jsonl"),
      "Suggested command preloads archive-only tool history."
    );
    const [handoffStat, toolHistoryStat, state] = await Promise.all([
      fs.stat(actionable.handoff.handoffPath),
      fs.stat(path.join(path.dirname(actionable.handoff.statePath), "tool_history.jsonl")),
      fs.readFile(actionable.handoff.statePath, "utf8").then((value) => JSON.parse(value)),
    ]);
    assert(handoffStat.size <= INITIAL_CONTEXT_MAX_BYTES, "handoff.md exceeds its hard limit.");
    assert(
      toolHistoryStat.size <= TOOL_HISTORY_ARCHIVE_MAX_BYTES,
      "tool history exceeds its archive limit."
    );
    assert(state.outcome === "actionable", "Persisted task state is not actionable.");

    console.log("Package smoke: PASS");
    console.log(`Version: ${installedVersion}`);
    console.log(`Packed size: ${packResult.size} bytes`);
    console.log("Completed flow: no handoff created");
    console.log("Simple flow: current session saved to default memory");
    console.log(`Actionable flow: ${handoffStat.size} initial-context bytes`);
  } finally {
    await fs.rm(temporaryRoot, { recursive: true, force: true });
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.stack ?? error.message : String(error));
  process.exitCode = 1;
});
