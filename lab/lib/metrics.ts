import type { ModelUsage } from "./types.ts";

export const MODEL_COST_FACTOR: Record<string, number> = {
  "furiosa-ai/Qwen3-32B-FP8": 1,
  "furiosa-ai/gpt-oss-120b": 2,
  "furiosa-ai/K-EXAONE-236B-A23B-NVFP4A16": 3
};

export function normalizedCost(
  model: string,
  tokens: { input: number; output: number; reasoning?: number },
  runKind: "test" | "submission" = "test"
): number {
  const factor = MODEL_COST_FACTOR[model] ?? 1;
  const runMultiplier = runKind === "test" ? 0.2 : 1;
  return (tokens.input + tokens.output + (tokens.reasoning ?? 0)) * factor * runMultiplier;
}
export function safeRunTokens(perRunTokenCap: number): number {
  if (!Number.isFinite(perRunTokenCap) || perRunTokenCap < 0) throw new Error("perRunTokenCap must be a non-negative finite number");
  return Math.floor(perRunTokenCap * 0.85);
}

export function safeItemTokens(perRunTokenCap: number, plannedItemCount: number): number {
  if (!Number.isInteger(plannedItemCount) || plannedItemCount <= 0) throw new Error("plannedItemCount must be a positive integer");
  return Math.floor(safeRunTokens(perRunTokenCap) / plannedItemCount);
}

export function capProjection(points: Array<{ completedItems: number; usedTokens: number }>, runTokenCap: number): { tokensPerItem: number; expectedExhaustionItem: number | null } {
  const usable = points.filter((point) => point.completedItems > 0 && point.usedTokens >= 0).sort((a, b) => a.completedItems - b.completedItems);
  const last = usable.at(-1);
  if (!last || last.usedTokens === 0) return { tokensPerItem: 0, expectedExhaustionItem: null };
  const tokensPerItem = last.usedTokens / last.completedItems;
  return { tokensPerItem, expectedExhaustionItem: Math.floor(runTokenCap / tokensPerItem) };
}

export function summarizeModelUsage(usage: ModelUsage[]): ModelUsage {
  return usage.reduce<ModelUsage>((total, item) => ({
    model: "all",
    calls: total.calls + item.calls,
    input: total.input + item.input,
    output: total.output + item.output,
    reasoning: total.reasoning + item.reasoning,
    cachedInput: total.cachedInput + item.cachedInput,
    normalizedCost: total.normalizedCost + item.normalizedCost,
    latencyMs: total.latencyMs + item.latencyMs
  }), { model: "all", calls: 0, input: 0, output: 0, reasoning: 0, cachedInput: 0, normalizedCost: 0, latencyMs: 0 });
}
