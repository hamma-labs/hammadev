import path from "node:path";
import { Command } from "commander";
import pc from "picocolors";
import { formatProjectStatus, getProjectStatus } from "../core/project-status.js";
import { ErrorCategory, formatCliError } from "../core/errors.js";

export function registerStatusCommand(program: Command): void {
  program
    .command("status")
    .option("--project <path>", "Project directory to inspect")
    .description("Show a read-only project and local session overview")
    .action(async (options) => {
      const projectPath = path.resolve(options.project ?? process.cwd());
      try {
        console.log(formatProjectStatus(await getProjectStatus(projectPath)));
      } catch (err: any) {
        console.error(pc.red(formatCliError("PROJECT_ERROR" as ErrorCategory, err)));
        process.exitCode = 1;
      }
    });
}
