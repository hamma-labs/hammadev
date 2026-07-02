import path from "node:path";
import pc from "picocolors";
import { getProjectStatus } from "./project-status.js";

const MIN_NODE_MAJOR = 20;

export async function runQuickstart(projectDir: string): Promise<void> {
  console.log(pc.bold("HammaDev quickstart\n"));

  const projectPath = path.resolve(projectDir);
  console.log("Project:");
  console.log(`  ${projectPath}\n`);

  let status;
  try {
    status = await getProjectStatus(projectPath);
  } catch (err: any) {
    console.error(pc.red(`Error reading project status: ${err.message}`));
    process.exit(1);
  }

  const nodeRaw = process.versions.node;
  const nodeMajor = Number(nodeRaw.split(".")[0]);
  const nodeOk = Number.isFinite(nodeMajor) && nodeMajor >= MIN_NODE_MAJOR;

  let hammaIgnored = "no";
  if (status.hammaIgnored === null) {
    hammaIgnored = status.gitStatus === "unavailable" ? "n/a (git unavailable)" : "n/a (not a repo)";
  } else if (status.hammaIgnored) {
    hammaIgnored = "yes";
  }

  console.log("Environment:");
  console.log(`  Node: ${nodeOk ? "ok" : "fail"}`);
  console.log(`  Git repo: ${status.isGitRepo ? "yes" : "no"}`);
  console.log(`  .hamma ignored: ${hammaIgnored}\n`);

  console.log("Detected agents:");
  console.log(`  Codex sessions: ${status.codexSessionCount}`);
  console.log(`  Claude sessions: ${status.claudeSessionCount}\n`);

  console.log("Try next:");
  if (status.codexSessionCount > 0) {
    console.log(`  hamma handoff codex:last --to claude`);
  } else if (status.claudeSessionCount > 0) {
    console.log(`  hamma handoff claude:last --to codex`);
  } else {
    console.log(`  hamma status`);
    console.log(`  hamma list codex`);
    console.log(`  hamma list claude`);
  }
}
