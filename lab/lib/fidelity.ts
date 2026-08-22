import { createHash } from "node:crypto";
import { normalizeNewlines, stripTrailingWhitespace } from "./compose.ts";
import type { ValidationIssue, ValidationResult } from "./types.ts";

export interface FidelitySurface {
  bytes: number;
  sha256: string;
  exactOriginalIncluded: boolean;
  exactLineCoverage: number;
  missingRepositoryPaths: string[];
}

export interface SWEFidelityReport {
  original: {
    bytes: number;
    sha256: string;
    nonEmptyLines: number;
    repositoryPaths: string[];
    fencedCodeBlocks: number;
  };
  plannerTask: FidelitySurface;
  solverInput: FidelitySurface;
  lossless: boolean;
}

function sha256(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

function canonical(value: string): string {
  return stripTrailingWhitespace(normalizeNewlines(value));
}

export function extractRepositoryPaths(request: string): string[] {
  const paths = new Set<string>();
  for (const match of canonical(request).matchAll(/^--- ([^\n]+?) \(lines [^)]+\) ---$/gm)) paths.add(match[1]!.trim());
  return [...paths];
}

function exactLineCoverage(original: string, target: string): number {
  const lines = original.split("\n").filter((line) => line.length > 0);
  if (lines.length === 0) return 1;
  const targetLines = new Set(target.split("\n"));
  return lines.filter((line) => targetLines.has(line)).length / lines.length;
}

function surface(original: string, target: string, paths: string[]): FidelitySurface {
  return {
    bytes: Buffer.byteLength(target, "utf8"),
    sha256: sha256(target),
    exactOriginalIncluded: target.includes(original),
    exactLineCoverage: exactLineCoverage(original, target),
    missingRepositoryPaths: paths.filter((path) => !target.includes(path))
  };
}

export function assessSWEFidelity(originalRequest: string, plannerTaskDescription: string, solverInput: string): ValidationResult<SWEFidelityReport> {
  const issues: ValidationIssue[] = [];
  const original = canonical(originalRequest);
  const planner = canonical(plannerTaskDescription);
  const solver = canonical(solverInput);
  const repositoryPaths = extractRepositoryPaths(original);
  const plannerSurface = surface(original, planner, repositoryPaths);
  const solverSurface = surface(original, solver, repositoryPaths);

  if (!original.includes("## Repository context") || repositoryPaths.length === 0) {
    issues.push({ code: "SWE_CONTEXT_SHAPE", message: "Original request does not contain a recognizable SWE repository context and excerpt path.", path: "originalRequest", severity: "error" });
  }
  if (!plannerSurface.exactOriginalIncluded) {
    issues.push({ code: "SWE_ORIGINAL_NOT_IN_PLANNER", message: "Planner task description does not contain the complete canonical original request.", path: "plannerTaskDescription", severity: "error" });
  }
  if (!solverSurface.exactOriginalIncluded) {
    issues.push({ code: "SWE_ORIGINAL_NOT_IN_SOLVER", message: "Solver input does not contain the complete canonical original request.", path: "solverInput", severity: "error" });
  }
  if (plannerSurface.missingRepositoryPaths.length > 0) {
    issues.push({ code: "SWE_PATH_MISSING_PLANNER", message: `Planner task is missing repository paths: ${plannerSurface.missingRepositoryPaths.join(", ")}.`, path: "plannerTaskDescription", severity: "error" });
  }
  if (solverSurface.missingRepositoryPaths.length > 0) {
    issues.push({ code: "SWE_PATH_MISSING_SOLVER", message: `Solver input is missing repository paths: ${solverSurface.missingRepositoryPaths.join(", ")}.`, path: "solverInput", severity: "error" });
  }
  if (/\[(?:content )?truncated\]|\.\.\.\s*truncated/i.test(planner) || /\[(?:content )?truncated\]|\.\.\.\s*truncated/i.test(solver)) {
    issues.push({ code: "SWE_TRUNCATION_MARKER", message: "A Planner or Solver surface contains an explicit truncation marker.", severity: "error" });
  }

  const report: SWEFidelityReport = {
    original: {
      bytes: Buffer.byteLength(original, "utf8"),
      sha256: sha256(original),
      nonEmptyLines: original.split("\n").filter(Boolean).length,
      repositoryPaths,
      fencedCodeBlocks: [...original.matchAll(/^```[^\n]*$/gm)].length / 2
    },
    plannerTask: plannerSurface,
    solverInput: solverSurface,
    lossless: issues.length === 0
  };
  return { ok: report.lossless, value: report, issues };
}
