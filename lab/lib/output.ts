import type { Track, ValidationIssue, ValidationResult } from "./types.ts";
import { normalizeNewlines } from "./compose.ts";

export interface PatchEdit {
  path: string;
  search: string;
  replace: string;
}

export interface LintedOutput {
  track: Exclude<Track, "unknown">;
  extracted: string;
  answer?: string;
  edits?: PatchEdit[];
}

export interface AggregationPreservation {
  track: Exclude<Track, "unknown">;
  solverArtifact: string;
  aggregatedArtifact: string;
  verbatim: boolean;
  judgedArtifactPreserved: boolean;
}

function lastMatch(regex: RegExp, value: string): RegExpExecArray | null {
  let result: RegExpExecArray | null = null;
  let current: RegExpExecArray | null;
  regex.lastIndex = 0;
  while ((current = regex.exec(value)) !== null) result = current;
  return result;
}

function boxedAnswer(line: string): string | null {
  const prefix = "FINAL ANSWER: \\boxed{";
  if (!line.startsWith(prefix)) return null;
  const body = line.slice(prefix.length);
  let depth = 1;
  let escaped = false;
  for (let index = 0; index < body.length; index += 1) {
    const character = body[index]!;
    if (escaped) {
      escaped = false;
      continue;
    }
    if (character === "\\") {
      escaped = true;
    } else if (character === "{") {
      depth += 1;
    } else if (character === "}") {
      depth -= 1;
      if (depth === 0) {
        if (index !== body.length - 1) return null;
        const answer = body.slice(0, index).trim();
        return answer || null;
      }
    }
  }
  return null;
}

function lintCoding(output: string, request?: string): ValidationResult<LintedOutput> {
  const issues: ValidationIssue[] = [];
  const normalized = normalizeNewlines(output).trim();
  const start = normalized.lastIndexOf("*** PATCH START ***");
  const end = normalized.indexOf("*** PATCH END ***", start + 1);
  if (start < 0 || end < 0) {
    return { ok: false, issues: [{ code: "FORMAT_PATCH_MARKER", message: "Missing final PATCH START/PATCH END markers.", severity: "error" }] };
  }
  const patch = normalized.slice(start, end + "*** PATCH END ***".length);
  if (patch !== normalized) {
    issues.push({ code: "FORMAT_PATCH_PROSE", message: "Coding output contains content outside the final patch markers.", severity: "error" });
  }
  const body = patch.slice("*** PATCH START ***".length, -"*** PATCH END ***".length).trim();
  const editRegex = /(?:^|\n)([^\n]+)\n<<<<<<< SEARCH\n(?:([\s\S]*?)\n)?=======\n([\s\S]*?)\n>>>>>>> REPLACE(?=\n|$)/g;
  const edits: PatchEdit[] = [];
  for (const match of body.matchAll(editRegex)) {
    edits.push({ path: match[1]!.trim(), search: match[2] ?? "", replace: match[3]! });
  }
  if (edits.length === 0) {
    issues.push({ code: "FORMAT_PATCH_BLOCK", message: "No valid SEARCH/REPLACE edit block found.", severity: "error" });
  }
  if (request) {
    const normalizedRequest = normalizeNewlines(request);
    for (const [index, edit] of edits.entries()) {
      if (!edit.path || /^(<|path\/to\/)/.test(edit.path)) {
        issues.push({ code: "FORMAT_PATCH_PATH", message: `Edit ${index + 1} has an invalid or placeholder path.`, severity: "error" });
      }
      if (edit.search.length === 0) {
        if (edit.path !== "solution.py" || !/empty repository/i.test(normalizedRequest)) {
          issues.push({ code: "FORMAT_EMPTY_SEARCH", message: `Empty SEARCH is allowed only for solution.py in an empty-repository request.`, severity: "error" });
        }
      } else if (!normalizedRequest.includes(edit.search)) {
        issues.push({ code: "FORMAT_SEARCH_MISMATCH", message: `SEARCH text for ${edit.path} does not occur verbatim in the request.`, severity: "error" });
      }
      if (!normalizedRequest.includes(edit.path) && !(edit.path === "solution.py" && /empty repository/i.test(normalizedRequest))) {
        issues.push({ code: "FORMAT_PATCH_UNKNOWN_FILE", message: `Path ${edit.path} is not present in the request.`, severity: "error" });
      }
    }
  }
  return { ok: !issues.some((issue) => issue.severity === "error"), value: { track: "coding", extracted: patch, edits }, issues };
}

function lintMath(output: string): ValidationResult<LintedOutput> {
  const normalized = normalizeNewlines(output).trim();
  const matches = normalized
    .split("\n")
    .map((line) => ({ line, answer: boxedAnswer(line) }))
    .filter((candidate): candidate is { line: string; answer: string } => candidate.answer !== null);
  const match = matches.at(-1);
  const issues: ValidationIssue[] = [];
  if (!match) {
    issues.push({ code: "FORMAT_FINAL_ANSWER", message: "Missing an exact FINAL ANSWER boxed line.", severity: "error" });
    return { ok: false, issues };
  }
  const extracted = match.line;
  if (normalized.split("\n").at(-1) !== extracted) {
    issues.push({ code: "FORMAT_FINAL_ANSWER_SUFFIX", message: "The boxed answer must be the final non-empty line.", severity: "error" });
  }
  const answer = match.answer;
  if (!answer) issues.push({ code: "FORMAT_FINAL_ANSWER_EMPTY", message: "The answer box is empty.", severity: "error" });
  return { ok: !issues.some((issue) => issue.severity === "error"), value: { track: "math", extracted, answer }, issues };
}

export function extractOptionLetters(request: string): Set<string> {
  const letters = new Set<string>();
  const normalized = normalizeNewlines(request);
  for (const match of normalized.matchAll(/(?:^|\n)\s*(?:\(([A-Z])\)|([A-Z])[.)])\s+/g)) {
    letters.add((match[1] ?? match[2])!);
  }
  return letters;
}

function lintGeneric(output: string, request?: string): ValidationResult<LintedOutput> {
  const normalized = normalizeNewlines(output).trim();
  const match = lastMatch(/^ANSWER: ([A-Z])$/gim, normalized);
  const issues: ValidationIssue[] = [];
  if (!match) {
    issues.push({ code: "FORMAT_OPTION_LETTER", message: "Missing an exact ANSWER: <letter> line.", severity: "error" });
    return { ok: false, issues };
  }
  const extracted = match[0].toUpperCase();
  if (normalized.split("\n").at(-1)?.toUpperCase() !== extracted) {
    issues.push({ code: "FORMAT_OPTION_SUFFIX", message: "The answer letter must be the final non-empty line.", severity: "error" });
  }
  const answer = match[1]!.toUpperCase();
  if (request) {
    const options = extractOptionLetters(request);
    if (options.size === 0) {
      issues.push({ code: "FORMAT_OPTION_SET_UNKNOWN", message: "Could not identify the request's option letters.", severity: "warning" });
    } else if (!options.has(answer)) {
      issues.push({ code: "FORMAT_OPTION_OUT_OF_RANGE", message: `Answer ${answer} is not among the provided options: ${[...options].join(", ")}.`, severity: "error" });
    }
  }
  return { ok: !issues.some((issue) => issue.severity === "error"), value: { track: "generic", extracted, answer }, issues };
}

export function lintOutput(track: Exclude<Track, "unknown">, output: string, request?: string): ValidationResult<LintedOutput> {
  if (track === "coding") return lintCoding(output, request);
  if (track === "math") return lintMath(output);
  return lintGeneric(output, request);
}

export function lintAggregationPreservation(
  track: Exclude<Track, "unknown">,
  solverOutput: string,
  aggregatedOutput: string,
  request?: string
): ValidationResult<AggregationPreservation> {
  const issues: ValidationIssue[] = [];
  const solver = lintOutput(track, solverOutput, request);
  const aggregated = lintOutput(track, aggregatedOutput, request);

  for (const issue of solver.issues) {
    issues.push({ ...issue, code: `AGGREGATION_SOLVER_${issue.code}`, path: issue.path ?? "solverOutput" });
  }
  for (const issue of aggregated.issues) {
    issues.push({ ...issue, code: `AGGREGATION_FINAL_${issue.code}`, path: issue.path ?? "aggregatedOutput" });
  }

  const verbatim = solverOutput === aggregatedOutput;
  const solverArtifact = solver.value?.extracted ?? "";
  const aggregatedArtifact = aggregated.value?.extracted ?? "";
  const judgedArtifactPreserved = solverArtifact.length > 0
    && aggregatedArtifact.length > 0
    && solverArtifact === aggregatedArtifact;

  if (!verbatim) {
    issues.push({
      code: "AGGREGATION_NOT_VERBATIM",
      message: "Native aggregation changed the Solver output bytes.",
      path: "aggregatedOutput",
      severity: "error"
    });
  }
  if (!judgedArtifactPreserved) {
    issues.push({
      code: "AGGREGATION_JUDGED_ARTIFACT_CHANGED",
      message: "The track artifact selected by the public output contract changed during aggregation.",
      path: "aggregatedOutput",
      severity: "error"
    });
  }

  return {
    ok: !issues.some((issue) => issue.severity === "error"),
    value: { track, solverArtifact, aggregatedArtifact, verbatim, judgedArtifactPreserved },
    issues
  };
}
