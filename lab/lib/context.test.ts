import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { assessContext, calculateCodingContextReport, estimateInputTokenRange, lintContextPolicy } from "./context.ts";
import type { CodingRequestManifest } from "./coverage.ts";

const prompt = readFileSync("prompts/coding.md", "utf8");
const manifest = JSON.parse(readFileSync("practice/manifests/coding-visible.requests.json", "utf8")) as CodingRequestManifest;

describe("model context feasibility", () => {
  it("keeps estimates explicitly ranged instead of claiming tokenizer-exact counts", () => {
    expect(estimateInputTokenRange(10_000)).toEqual({ lower: 2_500, upper: 4_000 });
    expect(assessContext("furiosa-ai/Qwen3-32B-FP8", 70_000, 12_288).risk).toBe("uncertain");
    expect(assessContext("furiosa-ai/gpt-oss-120b", 70_000, 12_288).risk).toBe("safe");
  });

  it("separates the transport guard from the downstream model-context route", () => {
    const report = calculateCodingContextReport(prompt, manifest);
    expect(report.routeCounts["transport-blocked"]).toBe(9);
    expect(report.rows.find((row) => row.itemId === "coding-visible-0017")).toMatchObject({
      transportFits: false,
      recommendedSolver: "furiosa-ai/gpt-oss-120b"
    });
    expect(report.rows.find((row) => row.itemId === "coding-visible-0041")).toMatchObject({
      transportFits: true,
      recommendedSolver: "furiosa-ai/Qwen3-32B-FP8"
    });
    expect(report.pagingReadiness).toMatchObject({
      status: "experimental-only",
      earliestFullRequestReceiver: "ARGUS Planner",
      plannerContextTokens: 40_000,
      canBypassTransportGuard: false,
      canExtendPlannerInputEnvelope: false,
      nativeSequentialDelivery: "unverified"
    });
    expect(report.estimator).toMatchObject({
      outputReservationTokens: 12_288,
      outputReservationBasis: "local-conservative-planning-only",
      runtimeEnforced: false,
      authoritativeRuntimeCap: "event-controlled-unverified"
    });
  });

  it("rejects invalid safety and output reservations", () => {
    expect(() => assessContext("furiosa-ai/Qwen3-32B-FP8", 1_000, -1)).toThrow(/outputReservationTokens/);
    expect(() => assessContext("furiosa-ai/Qwen3-32B-FP8", 1_000, 10, 1.1)).toThrow(/safeTotalShare/);
  });

  it("requires a context policy on the methodology-bearing candidate plan", () => {
    expect(lintContextPolicy({ methodology: {} })).toMatchObject({ ok: false });
    expect(lintContextPolicy({ creationMethod: "manual-new" })).toMatchObject({ ok: true });
    expect(lintContextPolicy({ creationMethod: "delivery" })).toMatchObject({ ok: true });
  });
});
