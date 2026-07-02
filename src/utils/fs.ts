import {
  appendFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  writeFileSync,
} from "node:fs";
import { dirname, join } from "node:path";

export function ensureDir(dir: string): void {
  mkdirSync(dir, { recursive: true });
}

export function readTextIfExists(file: string): string | null {
  if (!existsSync(file)) return null;
  return readFileSync(file, "utf8");
}

/** Write via temp file + rename so readers never observe a torn file. */
export function writeTextAtomic(file: string, contents: string): void {
  ensureDir(dirname(file));
  const tmp = join(dirname(file), `.${Date.now()}-${Math.random().toString(36).slice(2)}.tmp`);
  writeFileSync(tmp, contents, "utf8");
  renameSync(tmp, file);
}

export function appendLine(file: string, line: string): void {
  ensureDir(dirname(file));
  appendFileSync(file, `${line}\n`, "utf8");
}
