import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { auditCandidate, detectFallbackSignatures, lintSquadConfig, scanSecrets } from "./compliance.ts";

const candidate = JSON.parse(readFileSync("configs/candidates/argus-c0.plan.json", "utf8"));

describe("Squad compliance", () => {
  it("accepts the two-agent local candidate invariants", () => {
    expect(lintSquadConfig(candidate)).toMatchObject({ ok: true });
  });

  it("rejects attached tools and memory", () => {
    const invalid = structuredClone(candidate);
    invalid.agents[1].tools = ["read_file"];
    invalid.agents[1].memoryEnabled = true;
    const codes = lintSquadConfig(invalid).issues.map((issue) => issue.code);
    expect(codes).toContain("CONFIG_USER_TOOLS");
    expect(codes).toContain("CONFIG_MEMORY");
  });

  it("rejects unsafe budget drift and latent tool permissions", () => {
    const invalid = structuredClone(candidate);
    invalid.budget.maxTasks = 2;
    invalid.agents[0].toolConfig.toolPermissionOverrides = { read_file: "allow" };
    const codes = lintSquadConfig(invalid).issues.map((issue) => issue.code);
    expect(codes).toContain("CONFIG_BUDGET");
    expect(codes).toContain("CONFIG_USER_TOOLS");
  });

  it("rejects model context drift and an unevidenced paging promotion", () => {
    const invalid = structuredClone(candidate);
    invalid.contextPolicy.modelContextTokens["furiosa-ai/Qwen3-32B-FP8"] = 128_000;
    invalid.contextPolicy.solverRoute = "furiosa-ai/Qwen3-32B-FP8";
    invalid.contextPolicy.pagingCandidate = "baseline";
    const codes = lintSquadConfig(invalid).issues.map((issue) => issue.code);
    expect(codes).toContain("CONTEXT_MODEL_LIMIT");
    expect(codes).toContain("CONTEXT_SOLVER_ROUTE");
    expect(codes).toContain("CONTEXT_PAGING_STATUS");
  });

  it("keeps failed candidates unfrozen and counts only passed evidence", () => {
    const report = auditCandidate(candidate);
    expect(report.candidateValid).toBe(true);
    expect(report.freezeReady).toBe(false);
    expect(report.gatesPassed).toBe(2);
  });

  it("verifies failed and unverified evidence hashes instead of trusting status", () => {
    const tampered = structuredClone(candidate);
    tampered.evidence.requestByteGate.evidenceHash = `sha256:${"0".repeat(64)}`;
    const report = auditCandidate(tampered);
    expect(report.issues.map((issue) => issue.code)).toContain("GATE_HASH_MISMATCH");
    expect(report.freezeReady).toBe(false);
  });

  it("detects architecture fallback signatures case-insensitively", () => {
    expect(detectFallbackSignatures("Planner Call Failed; router is not running")).toEqual(["planner call failed", "router is not running"]);
  });

  it("detects credential-shaped content without flagging hashes", () => {
    const credentialShape = "api" + "_key=" + "sk" + "-" + "123456789012345678901234";
    expect(scanSecrets(credentialShape).ok).toBe(false);
    expect(scanSecrets("sha256:d676fc90bc7704708fd9cf600e75b40f327a9f7763502797de159972c0b28062").ok).toBe(true);
  });
});
