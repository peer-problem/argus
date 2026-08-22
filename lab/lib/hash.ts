import { createHash } from "node:crypto";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { isAbsolute, join, relative, resolve } from "node:path";
import type { ValidationIssue, ValidationResult } from "./types.ts";

export function sha256(value: string | Buffer): string {
  return createHash("sha256").update(value).digest("hex");
}

export function sha256File(path: string): string {
  return sha256(readFileSync(path));
}

function filesRecursively(root: string, current = root): string[] {
  return readdirSync(current, { withFileTypes: true }).flatMap((entry) => {
    const path = join(current, entry.name);
    if (entry.isDirectory()) return filesRecursively(root, path);
    return statSync(path).isFile() ? [path] : [];
  });
}

export function checksumManifest(root: string): Array<{ path: string; sha256: string; bytes: number }> {
  return filesRecursively(root)
    .sort()
    .map((path) => ({ path: relative(root, path), sha256: sha256File(path), bytes: statSync(path).size }));
}

interface HashEntry {
  path: string;
  sha256: string;
  jsonPath: string;
}

function hashEntries(value: unknown, jsonPath = "$", entries: HashEntry[] = []): HashEntry[] {
  if (Array.isArray(value)) {
    value.forEach((entry, index) => hashEntries(entry, `${jsonPath}[${index}]`, entries));
    return entries;
  }
  if (typeof value !== "object" || value === null) return entries;
  const object = value as Record<string, unknown>;
  if (typeof object.path === "string" && typeof object.sha256 === "string") {
    entries.push({ path: object.path, sha256: object.sha256.replace(/^sha256:/, ""), jsonPath });
  }
  for (const [key, child] of Object.entries(object)) hashEntries(child, `${jsonPath}.${key}`, entries);
  return entries;
}

export function verifyHashManifest(value: unknown, cwd = process.cwd()): ValidationResult<HashEntry[]> {
  const issues: ValidationIssue[] = [];
  const entries = hashEntries(value);
  if (entries.length === 0) issues.push({ code: "MANIFEST_EMPTY", message: "Manifest contains no {path, sha256} entries.", path: "$", severity: "error" });
  for (const entry of entries) {
    if (!/^[a-f0-9]{64}$/.test(entry.sha256)) {
      issues.push({ code: "MANIFEST_HASH_INVALID", message: `${entry.path} does not have a valid SHA-256 digest.`, path: `${entry.jsonPath}.sha256`, severity: "error" });
      continue;
    }
    const absolute = resolve(cwd, entry.path);
    const escapesRoot = isAbsolute(entry.path) || relative(cwd, absolute).startsWith("..");
    if (escapesRoot) {
      issues.push({ code: "MANIFEST_PATH_OUTSIDE_ROOT", message: `${entry.path} resolves outside the repository root.`, path: `${entry.jsonPath}.path`, severity: "error" });
      continue;
    }
    if (!existsSync(absolute)) {
      issues.push({ code: "MANIFEST_FILE_MISSING", message: `${entry.path} does not exist.`, path: `${entry.jsonPath}.path`, severity: "error" });
      continue;
    }
    if (sha256File(absolute) !== entry.sha256) issues.push({ code: "MANIFEST_HASH_MISMATCH", message: `${entry.path} does not match its recorded SHA-256 digest.`, path: `${entry.jsonPath}.sha256`, severity: "error" });
  }
  return { ok: issues.length === 0, value: entries, issues };
}
