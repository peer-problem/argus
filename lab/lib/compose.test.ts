import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { composeRequest, lintPrompt, placeholderCount, REQUIRED_OUTPUT } from "./compose.ts";

describe("prompt composition", () => {
  it("normalizes input, substitutes once, strips trailing whitespace, and appends the contract", () => {
    const prompt = "Static rule  \r\n\r\n{{TASK}}\r\n";
    const lint = lintPrompt(prompt);
    expect(lint.ok).toBe(false);

    const cleanPrompt = "Use only AI:GO native coordination. Never call or request a user tool.\n\n{{TASK}}\n";
    const result = composeRequest(cleanPrompt, "Question  \r\nline two\r\n", "math", "REQUIRED OUTPUT\r\nFINAL\r\n");
    expect(result).toBe("Use only AI:GO native coordination. Never call or request a user tool.\n\nQuestion\nline two\n\nREQUIRED OUTPUT\nFINAL\n");
  });

  it("rejects duplicated placeholders", () => {
    expect(placeholderCount("{{TASK}} {{TASK}}")) .toBe(2);
    expect(lintPrompt("{{TASK}} {{TASK}}\n").issues.some((issue) => issue.code === "PROMPT_TASK_COUNT")).toBe(true);
  });

  it("ships the byte-exact public output contracts", () => {
    expect(REQUIRED_OUTPUT.coding).toContain("Only what lies between *** PATCH START *** and *** PATCH END *** is graded.");
    expect(REQUIRED_OUTPUT.coding).toContain("`docs/contracts/patch-format.md`.");
    expect(REQUIRED_OUTPUT.math).toBe([
      "=== REQUIRED OUTPUT ===",
      "End your answer with a line of exactly this form:",
      "",
      "FINAL ANSWER: \\boxed{<answer>}",
      "",
      "Put the final answer, and nothing else, inside \\boxed{}.",
      "If more than one appears, the last one is used.",
      "Anything before it is ignored, not penalised."
    ].join("\n"));
    expect(REQUIRED_OUTPUT.generic).toContain("Replace <letter> with the single letter of the option you choose");
  });

  it("keeps the Coding prompt inside the measured direct-request budget", () => {
    const codingPrompt = readFileSync("prompts/coding.md", "utf8");
    expect(Buffer.byteLength(codingPrompt, "utf8")).toBeLessThanOrEqual(552);
  });

  it("rejects prompts that enable external execution", () => {
    const prompt = "Use only AI:GO native coordination. Never call or request a user tool. Use a shell to run tests.\n\n{{TASK}}\n";
    expect(lintPrompt(prompt).issues.map((issue) => issue.code)).toContain("PROMPT_EXTERNAL_ACTION");
  });

  it("keeps exactly one required-output contract after composing every live prompt", () => {
    for (const track of ["coding", "math", "generic"] as const) {
      const livePrompt = readFileSync(`prompts/${track}.md`, "utf8");
      const composed = composeRequest(livePrompt, "Representative request", track);
      expect(composed.match(/^=== REQUIRED OUTPUT ===$/gm)).toHaveLength(1);
    }
  });

  it("rejects a prompt that repeats the public contract header", () => {
    const prompt = "Use only AI:GO native coordination. Never call or request a user tool.\n=== REQUIRED OUTPUT ===\n\n{{TASK}}\n";
    expect(lintPrompt(prompt).issues.map((issue) => issue.code)).toContain("PROMPT_DUPLICATE_OUTPUT_CONTRACT");
  });
});
