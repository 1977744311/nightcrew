import { randomUUID } from "node:crypto";

export function newId(): string {
  return randomUUID();
}

export function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
}

export function isoNow(): string {
  return new Date().toISOString();
}

export function dateStamp(date = new Date()): string {
  return date.toISOString().slice(0, 10);
}
