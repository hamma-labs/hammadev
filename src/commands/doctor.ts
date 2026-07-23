import { Command } from "commander";
import { runDoctor } from "../core/doctor.js";

export function registerDoctorCommand(program: Command): void {
  program
    .command("doctor")
    .description("Validate environment, Codex availability, and .gitignore safety")
    .action(async () => {
      const code = await runDoctor();
      process.exitCode = code;
    });
}
