import { readFileSync } from "node:fs";
import { validateSchema } from "./schema.ts";
import type { ValidationIssue, ValidationResult } from "./types.ts";

const QWEN = "furiosa-ai/Qwen3-32B-FP8";
const GPT_OSS = "furiosa-ai/gpt-oss-120b";
const K_EXAONE = "furiosa-ai/K-EXAONE-236B-A23B-NVFP4A16";
const REQUIRED_IDS = ["ARGUS-G0", "ARGUS-C0", "ARGUS-C1", "ARGUS-C2", "ARGUS-C3"] as const;

type UnknownRecord = Record<string, unknown>;

function isRecord(value: unknown): value is UnknownRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === "string") : [];
}

function sameMembers(value: unknown, expected: string[]): boolean {
  const actual = stringArray(value);
  return actual.length === expected.length && expected.every((entry) => actual.includes(entry));
}

function requireCandidate(
  byId: Map<string, UnknownRecord>,
  id: string,
  issues: ValidationIssue[]
): UnknownRecord | null {
  const candidate = byId.get(id);
  if (!candidate) issues.push({ code: "LADDER_CANDIDATE_MISSING", message: `${id} is missing from the candidate ladder.`, path: "$.candidates", severity: "error" });
  return candidate ?? null;
}

function requireGate(candidate: UnknownRecord, gate: string, issues: ValidationIssue[]): void {
  if (!stringArray(candidate.promotionGates).includes(gate)) {
    issues.push({ code: "LADDER_GATE_MISSING", message: `${String(candidate.id)} must retain ${gate}.`, path: `$.candidates.${String(candidate.id)}.promotionGates`, severity: "error" });
  }
}

export function lintCandidateLadder(value: unknown): ValidationResult {
  const schema = validateSchema("candidate-ladder", value);
  const issues = [...schema.issues];
  if (!schema.ok || !isRecord(value)) return { ok: false, value, issues };

  const candidates = Array.isArray(value.candidates) ? value.candidates.filter(isRecord) : [];
  const ids = candidates.map((candidate) => String(candidate.id));
  if (new Set(ids).size !== ids.length || !sameMembers(ids, [...REQUIRED_IDS])) {
    issues.push({ code: "LADDER_IDS", message: "The ladder must contain each of ARGUS-G0 and ARGUS-C0..C3 exactly once.", path: "$.candidates", severity: "error" });
  }
  const byId = new Map(candidates.map((candidate) => [String(candidate.id), candidate]));

  for (const candidate of candidates) {
    if (stringArray(candidate.plannerModels).some((model) => ![QWEN, K_EXAONE].includes(model))) {
      issues.push({ code: "LADDER_PLANNER_MODEL", message: `${String(candidate.id)} contains a non-functional Planner model.`, path: `$.candidates.${String(candidate.id)}.plannerModels`, severity: "error" });
    }
    if (candidate.id !== "ARGUS-C0" && candidate.status !== "planned") {
      issues.push({ code: "LADDER_UNEVIDENCED_STATUS", message: `${String(candidate.id)} must remain plan-only until matched evidence exists.`, path: `$.candidates.${String(candidate.id)}.status`, severity: "error" });
    }
  }

  const g0 = requireCandidate(byId, "ARGUS-G0", issues);
  if (g0) {
    if (!sameMembers(g0.architectureVariants, ["A1", "A2", "A3", "AF"])) issues.push({ code: "LADDER_G0_ARCHITECTURES", message: "ARGUS-G0 must retain all four architecture kill-switch variants.", path: "$.candidates.ARGUS-G0.architectureVariants", severity: "error" });
    for (const gate of ["PLANNER_PROTOCOL", "SWE_FIDELITY", "FALLBACK_ZERO", "CAP_OBSERVED"]) requireGate(g0, gate, issues);
  }

  const c0 = requireCandidate(byId, "ARGUS-C0", issues);
  if (c0) {
    if (c0.status !== "testing" || c0.routePolicy !== "fixed" || !sameMembers(c0.architectureVariants, ["A2"]) || !sameMembers(c0.plannerModels, [QWEN]) || !sameMembers(c0.solverModels, [GPT_OSS]) || c0.reviewerModel !== null) {
      issues.push({ code: "LADDER_C0_DRIFT", message: "ARGUS-C0 must match the live two-agent Qwen Planner → GPT-OSS Solver baseline.", path: "$.candidates.ARGUS-C0", severity: "error" });
    }
  }

  const c1 = requireCandidate(byId, "ARGUS-C1", issues);
  if (c1) {
    if (c1.baseCandidate !== "ARGUS-C0" || c1.routePolicy !== "evidence-gated-cost-adaptive" || !sameMembers(c1.solverModels, [QWEN, GPT_OSS]) || c1.reviewerModel !== null) {
      issues.push({ code: "LADDER_C1_DRIFT", message: "ARGUS-C1 must be the evidence-gated Qwen/GPT-OSS cost route without a Reviewer.", path: "$.candidates.ARGUS-C1", severity: "error" });
    }
    for (const gate of ["PAIRED_SAMPLE_MATCH", "CONTEXT_ROUTE_EVIDENCE", "ACCURACY_COST_FRONTIER"]) requireGate(c1, gate, issues);
  }

  const c2 = requireCandidate(byId, "ARGUS-C2", issues);
  if (c2) {
    if (c2.baseCandidate !== "ARGUS-C1" || c2.routePolicy !== "reviewer-evidence-gated" || !sameMembers(c2.architectureVariants, ["A3"]) || c2.reviewerModel !== QWEN) {
      issues.push({ code: "LADDER_C2_DRIFT", message: "ARGUS-C2 must add exactly the evidence-gated Qwen Reviewer architecture.", path: "$.candidates.ARGUS-C2", severity: "error" });
    }
    for (const gate of ["REVIEWER_PAIRED_GAIN", "CONTEXT_DUPLICATION_MEASURED", "ACCURACY_COST_FRONTIER"]) requireGate(c2, gate, issues);
  }

  const c3 = requireCandidate(byId, "ARGUS-C3", issues);
  if (c3) {
    if (c3.baseCandidate !== "ARGUS-C2" || c3.routePolicy !== "planner-upgrade-only" || !sameMembers(c3.plannerModels, [K_EXAONE])) {
      issues.push({ code: "LADDER_C3_DRIFT", message: "ARGUS-C3 must change only the Planner route to K-EXAONE after C2 evidence.", path: "$.candidates.ARGUS-C3", severity: "error" });
    }
    for (const gate of ["PLANNER_PROTOCOL", "PAIRED_SAMPLE_MATCH", "ACCURACY_COST_FRONTIER"]) requireGate(c3, gate, issues);
  }

  return { ok: !issues.some((issue) => issue.severity === "error"), value, issues };
}

export function loadAndLintCandidateLadder(path: string): ValidationResult {
  let value: unknown;
  try {
    value = JSON.parse(readFileSync(path, "utf8"));
  } catch (error) {
    return { ok: false, issues: [{ code: "LADDER_JSON", message: `Invalid candidate ladder JSON: ${(error as Error).message}`, path, severity: "error" }] };
  }
  return lintCandidateLadder(value);
}
