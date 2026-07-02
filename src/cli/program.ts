import { Command } from "commander";
import { version } from "../../package.json";

export function buildProgram(): Command {
  const program = new Command();
  program.name("nightcrew").description("Your coding agents on the night shift.").version(version);
  return program;
}

export async function runCli(argv: string[]): Promise<void> {
  const program = buildProgram();
  await program.parseAsync(argv, { from: "user" });
}
