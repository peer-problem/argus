import { describe, expect, it } from "vitest";
import { assessSWEFidelity, extractRepositoryPaths } from "./fidelity.ts";

const original = [
  "You are resolving an issue in an existing repository.",
  "",
  "## Issue",
  "",
  "Return two instead of one.",
  "",
  "## Repository context",
  "",
  "Repository: sample/repo at commit abc123",
  "Retrieved 1 of 1 candidate source files.",
  "",
  "--- src/value.py (lines 1-2 of 2) ---",
  "```python",
  "def value():",
  "    return 1",
  "```"
].join("\n");

describe("SWE fidelity", () => {
  it("accepts wrapped surfaces only when both contain the complete canonical request", () => {
    const result = assessSWEFidelity(original, `Solve this exactly:\n\n${original}`, `Task context:\n${original}\n\nReturn the patch.`);
    expect(result).toMatchObject({
      ok: true,
      value: {
        lossless: true,
        original: { repositoryPaths: ["src/value.py"], fencedCodeBlocks: 1 },
        plannerTask: { exactOriginalIncluded: true, exactLineCoverage: 1 },
        solverInput: { exactOriginalIncluded: true, exactLineCoverage: 1 }
      }
    });
  });

  it("rejects a lossy Planner summary even when it retains the path", () => {
    const result = assessSWEFidelity(original, "Fix src/value.py so value returns two.", `Task context:\n${original}`);
    expect(result.ok).toBe(false);
    expect(result.value?.plannerTask.exactLineCoverage).toBeLessThan(1);
    expect(result.issues.map((issue) => issue.code)).toContain("SWE_ORIGINAL_NOT_IN_PLANNER");
  });

  it("rejects one changed code line or an explicit truncation marker", () => {
    const changed = original.replace("    return 1", "    return 9");
    const result = assessSWEFidelity(original, original, `${changed}\n[content truncated]`);
    expect(result.ok).toBe(false);
    expect(result.issues.map((issue) => issue.code)).toEqual(expect.arrayContaining([
      "SWE_ORIGINAL_NOT_IN_SOLVER",
      "SWE_TRUNCATION_MARKER"
    ]));
  });

  it("extracts every published excerpt path", () => {
    expect(extractRepositoryPaths(`${original}\n--- tests/test_value.py (lines 1-3 of 3) ---\n\n`)).toEqual([
      "src/value.py",
      "tests/test_value.py"
    ]);
  });
});
