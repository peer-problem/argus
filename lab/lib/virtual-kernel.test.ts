import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { lintVirtualKernelConfig, lintVirtualKernelTrackPrompt, VIRTUAL_KERNEL_STAGES } from "./virtual-kernel.ts";

const candidate = JSON.parse(readFileSync("configs/candidates/argus-c0.plan.json", "utf8"));

describe("ARGUS Virtual Kernel v1", () => {
  it("binds the five-stage, single-repair protocol to the Solver only", () => {
    expect(VIRTUAL_KERNEL_STAGES).toEqual(["normalize", "solve", "assert", "repair", "emit"]);
    expect(lintVirtualKernelConfig(candidate)).toMatchObject({ ok: true });
  });

  it("rejects a fabricated Kernel Agent and an unbounded repair loop", () => {
    const invalid = structuredClone(candidate);
    invalid.agents.push({ ...invalid.agents[1], name: "Kernel Agent", role: "State Keeper" });
    invalid.agents[1].systemPrompt = invalid.agents[1].systemPrompt.replace("at most once", "until every check passes");
    const codes = lintVirtualKernelConfig(invalid).issues.map((issue) => issue.code);
    expect(codes).toContain("VK_FORBIDDEN_ROLE");
    expect(codes).toContain("VK_REPAIR_LIMIT");
  });

  it.each(["coding", "math", "generic"] as const)("ships a %s one-shot route with its track assertions", (track) => {
    const prompt = readFileSync(`prompts/${track}.md`, "utf8");
    expect(lintVirtualKernelTrackPrompt(track, prompt, `prompts/${track}.md`)).toMatchObject({ ok: true });
  });

  it("does not accept a pitch label without the actual protocol", () => {
    const prompt = "ARGUS Virtual Kernel v1. one ARGUS Solver task; no others. {{TASK}}";
    expect(lintVirtualKernelTrackPrompt("math", prompt).ok).toBe(false);
  });
});
