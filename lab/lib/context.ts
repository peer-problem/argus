import { calculateCodingCoverage, type CodingRequestManifest } from "./coverage.ts";
import type { ValidationIssue, ValidationResult } from "./types.ts";

export const MODEL_CONTEXTS = {
  "furiosa-ai/Qwen3-32B-FP8": { label: "Qwen3-32B", contextTokens: 40_000, relativeCost: 1 },
  "furiosa-ai/gpt-oss-120b": { label: "GPT-OSS-120B", contextTokens: 128_000, relativeCost: 2 },
  "furiosa-ai/K-EXAONE-236B-A23B-NVFP4A16": { label: "K-EXAONE-236B", contextTokens: 48_000, relativeCost: 3 }
} as const;

export type ContextModelId = keyof typeof MODEL_CONTEXTS;
export type ContextRisk = "safe" | "uncertain" | "over-safe-budget" | "over-hard-limit";

export interface ContextAssessment {
  model: ContextModelId;
  contextTokens: number;
  safeTotalTokens: number;
  outputReservationTokens: number;
  estimatedInputTokens: { lower: number; upper: number };
  estimatedTotalTokens: { lower: number; upper: number };
  risk: ContextRisk;
}

export interface CodingContextRow {
  itemId: string;
  kind: "swebench" | "livecodebench";
  composedBytes: number;
  transportFits: boolean;
  assessments: Record<ContextModelId, ContextAssessment>;
  recommendedSolver: ContextModelId | null;
  reason: string;
}

export interface CodingContextReport {
  estimator: {
    note: string;
    bytesPerToken: { lowerBound: number; upperBound: number };
    safeTotalShare: number;
    outputReservationTokens: number;
    outputReservationBasis: "local-conservative-planning-only";
    runtimeEnforced: false;
    authoritativeRuntimeCap: "event-controlled-unverified";
  };
  modelContexts: typeof MODEL_CONTEXTS;
  transportGuardBytes: number;
  pagingReadiness: {
    status: "experimental-only";
    earliestFullRequestReceiver: "ARGUS Planner";
    plannerModel: "furiosa-ai/Qwen3-32B-FP8";
    plannerContextTokens: 40_000;
    canBypassTransportGuard: false;
    canExtendPlannerInputEnvelope: false;
    nativeSequentialDelivery: "unverified";
    requiredEvidence: string[];
  };
  routeCounts: Record<string, number>;
  rows: CodingContextRow[];
}

type UnknownRecord = Record<string, unknown>;

function isRecord(value: unknown): value is UnknownRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function configuredModel(agent: UnknownRecord | undefined): unknown {
  if (!agent) return undefined;
  const preferences = isRecord(agent.modelPreferences) ? agent.modelPreferences : {};
  return typeof agent.model === "string" ? agent.model : preferences.preferredModelId;
}

export function lintContextPolicy(config: unknown): ValidationResult {
  const issues: ValidationIssue[] = [];
  if (!isRecord(config)) return { ok: false, issues: [{ code: "CONTEXT_CONFIG_SHAPE", message: "Config must be an object before its context policy can be checked.", severity: "error" }] };

  const policy = isRecord(config.contextPolicy) ? config.contextPolicy : null;
  if (isRecord(config.methodology) && !policy) {
    return { ok: false, value: config, issues: [{ code: "CONTEXT_POLICY_MISSING", message: "The direct candidate must declare the official model context limits and routing policy.", path: "$.contextPolicy", severity: "error" }] };
  }
  if (!policy) return { ok: true, value: config, issues };

  if (policy.source !== ".agents/instructions/INSTRUCTIONS.md") {
    issues.push({ code: "CONTEXT_SOURCE", message: "Context limits must cite the current challenge instructions.", path: "$.contextPolicy.source", severity: "error" });
  }
  if (policy.safeTotalShare !== 0.85 || policy.outputReservationTokens !== 12_288) {
    issues.push({ code: "CONTEXT_ENVELOPE", message: "The candidate must retain the 85% planning envelope and 12,288-token conservative output reservation.", path: "$.contextPolicy", severity: "error" });
  }
  if (policy.outputReservationBasis !== "local-conservative-planning-only" || policy.evaluationSettingsOverridesReachRuntime !== false || policy.authoritativeRuntimeCap !== "event-controlled-unverified") {
    issues.push({ code: "CONTEXT_RUNTIME_CAP_BOUNDARY", message: "The plan must state that the output reservation is local-only, settingsOverrides do not reach evaluation, and the event cap is authoritative but unverified.", path: "$.contextPolicy", severity: "error" });
  }

  const declaredContexts = isRecord(policy.modelContextTokens) ? policy.modelContextTokens : {};
  for (const [model, details] of Object.entries(MODEL_CONTEXTS)) {
    if (declaredContexts[model] !== details.contextTokens) {
      issues.push({ code: "CONTEXT_MODEL_LIMIT", message: `${details.label} must declare the official ${details.contextTokens.toLocaleString("en-US")}-token context limit.`, path: `$.contextPolicy.modelContextTokens.${model}`, severity: "error" });
    }
  }

  const agents = Array.isArray(config.agents) ? config.agents.filter(isRecord) : [];
  const plannerModel = configuredModel(agents.find((agent) => agent.name === "ARGUS Planner"));
  const solverModel = configuredModel(agents.find((agent) => agent.name === "ARGUS Solver"));
  if (policy.plannerRoute !== "furiosa-ai/Qwen3-32B-FP8" || policy.plannerRoute !== plannerModel) {
    issues.push({ code: "CONTEXT_PLANNER_ROUTE", message: "The context policy and candidate must bind the thin Planner to Qwen3-32B.", path: "$.contextPolicy.plannerRoute", severity: "error" });
  }
  if (policy.solverRoute !== "furiosa-ai/gpt-oss-120b" || policy.solverRoute !== solverModel) {
    issues.push({ code: "CONTEXT_SOLVER_ROUTE", message: "The context policy and candidate must bind the universal Solver to GPT-OSS-120B's 128K envelope.", path: "$.contextPolicy.solverRoute", severity: "error" });
  }
  if (policy.pagingCandidate !== "experimental-only") {
    issues.push({ code: "CONTEXT_PAGING_STATUS", message: "Context paging must remain experimental until native sequential delivery and Pareto gain are evidenced.", path: "$.contextPolicy.pagingCandidate", severity: "error" });
  }
  const pagingGate = typeof policy.pagingGate === "string" ? policy.pagingGate : "";
  if (!/native sequential task context/i.test(pagingGate) || !/lossless chunk ordering/i.test(pagingGate) || !/pre-Squad transport rejection/i.test(pagingGate)) {
    issues.push({ code: "CONTEXT_PAGING_GATE", message: "Paging must require lossless native ordering and explicitly acknowledge that it cannot bypass pre-Squad transport rejection.", path: "$.contextPolicy.pagingGate", severity: "error" });
  }

  return { ok: issues.length === 0, value: config, issues };
}

export function estimateInputTokenRange(bytes: number): { lower: number; upper: number } {
  if (!Number.isFinite(bytes) || bytes < 0) throw new Error("bytes must be a non-negative finite number");
  return { lower: Math.ceil(bytes / 4), upper: Math.ceil(bytes / 2.5) };
}

export function assessContext(model: ContextModelId, inputBytes: number, outputReservationTokens: number, safeTotalShare = 0.85): ContextAssessment {
  if (!Number.isInteger(outputReservationTokens) || outputReservationTokens < 0) throw new Error("outputReservationTokens must be a non-negative integer");
  if (!Number.isFinite(safeTotalShare) || safeTotalShare <= 0 || safeTotalShare > 1) throw new Error("safeTotalShare must be in (0, 1]");
  const contextTokens = MODEL_CONTEXTS[model].contextTokens;
  const safeTotalTokens = Math.floor(contextTokens * safeTotalShare);
  const estimatedInputTokens = estimateInputTokenRange(inputBytes);
  const estimatedTotalTokens = {
    lower: estimatedInputTokens.lower + outputReservationTokens,
    upper: estimatedInputTokens.upper + outputReservationTokens
  };
  const risk: ContextRisk = estimatedTotalTokens.lower > contextTokens
    ? "over-hard-limit"
    : estimatedTotalTokens.lower > safeTotalTokens
      ? "over-safe-budget"
      : estimatedTotalTokens.upper <= safeTotalTokens
        ? "safe"
        : "uncertain";
  return { model, contextTokens, safeTotalTokens, outputReservationTokens, estimatedInputTokens, estimatedTotalTokens, risk };
}

export function calculateCodingContextReport(prompt: string, manifest: CodingRequestManifest, outputReservationTokens = 12_288): CodingContextReport {
  const transport = calculateCodingCoverage(prompt, manifest);
  const modelIds = Object.keys(MODEL_CONTEXTS) as ContextModelId[];
  const rows = transport.rows.map((row): CodingContextRow => {
    const assessments = Object.fromEntries(modelIds.map((model) => [model, assessContext(model, row.composedBytes, outputReservationTokens)])) as Record<ContextModelId, ContextAssessment>;
    const qwen = "furiosa-ai/Qwen3-32B-FP8" as const;
    const gpt = "furiosa-ai/gpt-oss-120b" as const;
    const recommendedSolver = assessments[qwen].risk === "safe" ? qwen : assessments[gpt].risk === "safe" ? gpt : null;
    const reason = !row.fits
      ? "Blocked before model context by the installed 65,536-byte direct transport guard; an in-Squad pager cannot bypass it."
      : recommendedSolver === qwen
        ? "Qwen stays within the conservative 85% total-context envelope."
        : recommendedSolver === gpt
          ? "Qwen is uncertain or over budget; GPT-OSS provides the verified 128K context envelope."
          : "No configured model is conservatively safe; require an organizer-supported transport and a measured paging experiment."
    return { itemId: row.itemId, kind: row.kind, composedBytes: row.composedBytes, transportFits: row.fits, assessments, recommendedSolver, reason };
  });
  const routeCounts = rows.reduce<Record<string, number>>((counts, row) => {
    const key = !row.transportFits ? "transport-blocked" : row.recommendedSolver ?? "no-safe-route";
    counts[key] = (counts[key] ?? 0) + 1;
    return counts;
  }, {});
  return {
    estimator: {
      note: "Range estimate only; hosted tokenizer telemetry and event per-run caps are authoritative. The 12,288-token output reservation is a conservative local planning assumption, not an evaluation setting.",
      bytesPerToken: { lowerBound: 4, upperBound: 2.5 },
      safeTotalShare: 0.85,
      outputReservationTokens,
      outputReservationBasis: "local-conservative-planning-only",
      runtimeEnforced: false,
      authoritativeRuntimeCap: "event-controlled-unverified"
    },
    modelContexts: MODEL_CONTEXTS,
    transportGuardBytes: transport.maximumAllowedBytes,
    pagingReadiness: {
      status: "experimental-only",
      earliestFullRequestReceiver: "ARGUS Planner",
      plannerModel: "furiosa-ai/Qwen3-32B-FP8",
      plannerContextTokens: MODEL_CONTEXTS["furiosa-ai/Qwen3-32B-FP8"].contextTokens,
      canBypassTransportGuard: false,
      canExtendPlannerInputEnvelope: false,
      nativeSequentialDelivery: "unverified",
      requiredEvidence: [
        "A request must reach the Planner before any in-Squad paging can begin.",
        "Native dependency context must preserve chunk order, exact paths, code lines, and output contracts.",
        "A matched paired run must improve context failure or accuracy without losing the normalized-cost Pareto frontier."
      ]
    },
    routeCounts,
    rows
  };
}
