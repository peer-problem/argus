import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { auditCandidate, REQUIRED_GATES } from "./compliance.ts";
import type { GateEvidence, ValidationIssue } from "./types.ts";

type UnknownRecord = Record<string, unknown>;

export const HANDOFF_REQUIRED_PATHS = [
  "README.md",
  "package.json",
  "prompts/coding.md",
  "prompts/math.md",
  "prompts/generic.md",
  "configs/candidates/argus-c0.plan.json",
  "configs/candidates/argus-c0.aigo.json",
  "configs/candidates/argus-c0.delivery.json",
  "configs/candidates/argus-c0.mapping.json",
  "configs/candidates/argus-candidate-ladder.json",
  "practice/manifests/calibration-plan.json",
  "schemas/argus-event.schema.json",
  "schemas/argus-run.schema.json",
  "schemas/argus-experiment.schema.json",
  "schemas/argus-candidate-ladder.schema.json",
  "lab/cli.ts",
  "apps/argus-trace/src/App.tsx",
  "docs/phase-1/PRD.md",
  "docs/phase-1/RUNBOOK.md",
  "docs/phase-1/COMPLIANCE.md",
  "docs/phase-1/IMPLEMENTATION.md",
  "docs/phase-1/COMPLETION-AUDIT.md",
  "docs/phase-1/HANDOFF.md"
] as const;

const DEFERRED_REASONS: Record<(typeof REQUIRED_GATES)[number], string> = {
  requestByteGate: "Known desktop transport limitation; hosted-runner or organizer evidence is required, not a local code change.",
  plannerProtocolGate: "Native Planner protocol evidence.",
  sweFidelityGate: "Requires a completed live SWE request across the original, Planner-task, and Solver-input surfaces.",
  submissionBindingGate: "Portal free-check binding evidence.",
  capGate: "Requires one separately approved portal evaluation with cap/cache telemetry.",
  fallbackGate: "Fallback kill-switch evidence.",
  formatGate: "Requires current-C0 live Coding, Math, and Generic output artifacts."
};

function isRecord(value: unknown): value is UnknownRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export interface HandoffGate {
  gate: (typeof REQUIRED_GATES)[number];
  status: GateEvidence["status"] | "missing";
  evidenceRef: string | null;
  deferred: boolean;
  reason: string;
}

export interface HandoffReport {
  codebaseReady: boolean;
  submissionReady: boolean;
  candidateValid: boolean;
  gatesPassed: number;
  gatesRequired: number;
  requiredPathsPresent: number;
  requiredPathsTotal: number;
  missingPaths: string[];
  deferredExternalValidation: HandoffGate[];
  structuralIssues: ValidationIssue[];
  handoffBoundary: string;
}

export function assessHandoff(config: unknown, cwd = process.cwd()): HandoffReport {
  const audit = auditCandidate(config, cwd);
  const candidate = isRecord(config) ? config : {};
  const evidence = isRecord(candidate.evidence) ? candidate.evidence : {};
  const missingPaths = HANDOFF_REQUIRED_PATHS.filter((path) => !existsSync(resolve(cwd, path)));
  const structuralIssues = audit.issues.filter((issue) => issue.code !== "GATE_UNVERIFIED");
  const deferredExternalValidation = REQUIRED_GATES.flatMap((gate): HandoffGate[] => {
    const gateValue = isRecord(evidence[gate]) ? evidence[gate] : {};
    const status = ["passed", "failed", "unverified"].includes(String(gateValue.status))
      ? gateValue.status as GateEvidence["status"]
      : "missing";
    if (status === "passed") return [];
    return [{
      gate,
      status,
      evidenceRef: typeof gateValue.evidenceRef === "string" ? gateValue.evidenceRef : null,
      deferred: true,
      reason: DEFERRED_REASONS[gate]
    }];
  });
  const codebaseReady = audit.candidateValid && missingPaths.length === 0 && structuralIssues.length === 0;

  return {
    codebaseReady,
    submissionReady: audit.freezeReady,
    candidateValid: audit.candidateValid,
    gatesPassed: audit.gatesPassed,
    gatesRequired: audit.gatesRequired,
    requiredPathsPresent: HANDOFF_REQUIRED_PATHS.length - missingPaths.length,
    requiredPathsTotal: HANDOFF_REQUIRED_PATHS.length,
    missingPaths,
    deferredExternalValidation,
    structuralIssues,
    handoffBoundary: "codebaseReady validates the repository handoff package; submissionReady additionally requires live performance and portal evidence."
  };
}
