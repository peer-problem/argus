import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { assessHandoff, HANDOFF_REQUIRED_PATHS } from "./handoff.ts";

const load = () => JSON.parse(readFileSync("configs/candidates/argus-c0.plan.json", "utf8"));

describe("handoff readiness", () => {
  it("separates a complete codebase handoff from deferred live submission evidence", () => {
    const report = assessHandoff(load());
    expect(report.codebaseReady).toBe(true);
    expect(report.submissionReady).toBe(false);
    expect(report.candidateValid).toBe(true);
    expect(report.requiredPathsPresent).toBe(HANDOFF_REQUIRED_PATHS.length);
    expect(report.missingPaths).toEqual([]);
    expect(report.deferredExternalValidation.map((entry) => entry.gate)).toEqual([
      "requestByteGate",
      "sweFidelityGate",
      "capGate",
      "formatGate"
    ]);
  });

  it("fails handoff readiness on structural artifact drift", () => {
    const config = load();
    config.mappingManifest = "configs/candidates/does-not-exist.json";
    const report = assessHandoff(config);
    expect(report.codebaseReady).toBe(false);
    expect(report.structuralIssues.map((issue) => issue.code)).toContain("ARTIFACT_MISSING");
  });

  it("fails handoff readiness when an evidence hash drifts", () => {
    const config = load();
    config.evidence.formatGate.evidenceHash = `sha256:${"0".repeat(64)}`;
    const report = assessHandoff(config);
    expect(report.codebaseReady).toBe(false);
    expect(report.structuralIssues.map((issue) => issue.code)).toContain("GATE_HASH_MISMATCH");
  });
});
