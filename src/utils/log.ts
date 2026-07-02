import pc from "picocolors";

let verbose = false;

export function setVerbose(value: boolean): void {
  verbose = value;
}

function stamp(): string {
  return pc.dim(new Date().toISOString().slice(11, 19));
}

export const log = {
  info(message: string): void {
    console.log(`${stamp()} ${message}`);
  },
  warn(message: string): void {
    console.warn(`${stamp()} ${pc.yellow(message)}`);
  },
  error(message: string): void {
    console.error(`${stamp()} ${pc.red(message)}`);
  },
  debug(message: string): void {
    if (verbose) console.log(`${stamp()} ${pc.dim(message)}`);
  },
};
