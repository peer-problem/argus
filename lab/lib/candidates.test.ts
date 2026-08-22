import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { lintCandidateLadder } from "./candidates.ts";

const load = () => JSON.parse(readFileSync("configs/candidates/argus-candidate-ladder.json", "utf8"));

describe("candidate ladder", () => {
  it("keeps G0 and C0..C3 explicit while only C0 is testing", () => {
    const ladder = load();
    const result = lintCandidateLadder(ladder);
    expect(result.ok).toBe(true);
    expect(ladder.candidates.map((candidate: { id: string }) => candidate.id)).toEqual([
      "ARGUS-G0",
      "ARGUS-C0",
      "ARGUS-C1",
      "ARGUS-C2",
      "ARGUS-C3"
    ]);
    expect(ladder.candidates.filter((candidate: { status: string }) => candidate.status === "testing").map((candidate: { id: string }) => candidate.id)).toEqual(["ARGUS-C0"]);
  });

  it("rejects GPT-OSS as a Planner candidate", () => {
    const ladder = load();
    ladder.candidates.find((candidate: { id: string }) => candidate.id === "ARGUS-C1").plannerModels = ["furiosa-ai/gpt-oss-120b"];
    expect(lintCandidateLadder(ladder).issues.map((issue) => issue.code)).toContain("SCHEMA_ENUM");
  });

  it("rejects unevidenced promotion and baseline route drift", () => {
    const ladder = load();
    ladder.candidates.find((candidate: { id: string }) => candidate.id === "ARGUS-C2").status = "testing";
    ladder.candidates.find((candidate: { id: string }) => candidate.id === "ARGUS-C0").solverModels = ["furiosa-ai/Qwen3-32B-FP8"];
    const codes = lintCandidateLadder(ladder).issues.map((issue) => issue.code);
    expect(codes).toEqual(expect.arrayContaining(["LADDER_UNEVIDENCED_STATUS", "LADDER_C0_DRIFT"]));
  });
});
