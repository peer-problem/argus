import { describe, expect, it } from "vitest";
import { capProjection, normalizedCost, safeItemTokens, safeRunTokens } from "./metrics.ts";

describe("cost and cap metrics", () => {
  it("applies model and test-run multipliers", () => {
    expect(normalizedCost("furiosa-ai/Qwen3-32B-FP8", { input: 900, output: 100 }, "test")).toBe(200);
    expect(normalizedCost("furiosa-ai/gpt-oss-120b", { input: 900, output: 100 }, "submission")).toBe(2000);
    expect(normalizedCost("furiosa-ai/K-EXAONE-236B-A23B-NVFP4A16", { input: 900, output: 100 }, "submission")).toBe(3000);
  });

  it("holds a 15 percent run-token margin", () => {
    expect(safeRunTokens(100_000)).toBe(85_000);
    expect(safeItemTokens(100_000, 10)).toBe(8_500);
  });

  it("projects cap exhaustion from observed burn", () => {
    expect(capProjection([{ completedItems: 4, usedTokens: 20_000 }], 100_000)).toEqual({ tokensPerItem: 5_000, expectedExhaustionItem: 20 });
  });
});
