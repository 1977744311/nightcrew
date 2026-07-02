import { closeSync, existsSync, openSync, readSync, statSync } from "node:fs";

/**
 * Poll-based JSONL tailer. Polling (not fs.watch) because the console must
 * reliably follow files written by daemons it did not spawn, across editors,
 * platforms, and atomic-rename writers.
 */
export class JsonlTailer {
  private offset = 0;
  private timer: NodeJS.Timeout | null = null;

  constructor(
    private readonly file: string,
    private readonly onLine: (line: string) => void,
    private readonly intervalMs = 1_000,
  ) {}

  start(fromEnd = true): void {
    if (fromEnd && existsSync(this.file)) {
      this.offset = statSync(this.file).size;
    }
    this.timer = setInterval(() => this.poll(), this.intervalMs);
    this.timer.unref();
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  private poll(): void {
    if (!existsSync(this.file)) return;
    const size = statSync(this.file).size;
    if (size < this.offset) this.offset = 0; // truncated/rotated
    if (size === this.offset) return;

    const fd = openSync(this.file, "r");
    try {
      const length = size - this.offset;
      const buffer = Buffer.alloc(length);
      readSync(fd, buffer, 0, length, this.offset);
      this.offset = size;
      const text = buffer.toString("utf8");
      for (const line of text.split("\n")) {
        if (line.trim()) this.onLine(line);
      }
    } finally {
      closeSync(fd);
    }
  }
}
