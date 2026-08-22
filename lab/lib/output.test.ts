import { describe, expect, it } from "vitest";
import { extractOptionLetters, lintAggregationPreservation, lintOutput } from "./output.ts";

describe("output lint", () => {
  it("accepts an applicable coding edit", () => {
    const request = "## Repository context\nFile: src/value.py\n\ndef value():\n    return 1\n";
    const output = "*** PATCH START ***\nsrc/value.py\n<<<<<<< SEARCH\ndef value():\n    return 1\n=======\ndef value():\n    return 2\n>>>>>>> REPLACE\n*** PATCH END ***";
    const result = lintOutput("coding", output, request);
    expect(result.ok).toBe(true);
    expect(result.value?.edits).toHaveLength(1);
  });

  it("rejects a hallucinated SEARCH block", () => {
    const request = "File: src/value.py\nreturn 1\n";
    const output = "*** PATCH START ***\nsrc/value.py\n<<<<<<< SEARCH\nreturn 9\n=======\nreturn 2\n>>>>>>> REPLACE\n*** PATCH END ***";
    expect(lintOutput("coding", output, request).issues.map((issue) => issue.code)).toContain("FORMAT_SEARCH_MISMATCH");
  });

  it("accepts empty SEARCH only for empty-repository solution.py", () => {
    const request = "The repository is an empty repository. Create solution.py.";
    const output = "*** PATCH START ***\nsolution.py\n<<<<<<< SEARCH\n\n=======\nprint(input())\n>>>>>>> REPLACE\n*** PATCH END ***";
    expect(lintOutput("coding", output, request).ok).toBe(true);
  });

  it("uses the last exact math line", () => {
    const good = "short check\nFINAL ANSWER: \\boxed{17}";
    const bad = "FINAL ANSWER: \\boxed{17}\nextra";
    expect(lintOutput("math", good).ok).toBe(true);
    expect(lintOutput("math", bad).ok).toBe(false);
  });

  it("checks the provided generic option set instead of assuming ten choices", () => {
    const request = "Question\n(A) Alpha\n(B) Beta\n(C) Gamma";
    expect([...extractOptionLetters(request)]).toEqual(["A", "B", "C"]);
    expect(lintOutput("generic", "ANSWER: C", request).ok).toBe(true);
    expect(lintOutput("generic", "ANSWER: D", request).ok).toBe(false);
  });

  it("proves a byte-identical Solver artifact survives aggregation", () => {
    const request = "File: src/value.py\nreturn 1\n";
    const output = "*** PATCH START ***\nsrc/value.py\n<<<<<<< SEARCH\nreturn 1\n=======\nreturn 2\n>>>>>>> REPLACE\n*** PATCH END ***";
    expect(lintAggregationPreservation("coding", output, output, request)).toMatchObject({
      ok: true,
      value: { verbatim: true, judgedArtifactPreserved: true }
    });
  });

  it("detects corruption of the judged Coding artifact", () => {
    const request = "File: src/value.py\nreturn 1\n";
    const solver = "*** PATCH START ***\nsrc/value.py\n<<<<<<< SEARCH\nreturn 1\n=======\nreturn 2\n>>>>>>> REPLACE\n*** PATCH END ***";
    const aggregated = solver.replace("return 2", "return 3");
    const result = lintAggregationPreservation("coding", solver, aggregated, request);
    expect(result.ok).toBe(false);
    expect(result.issues.map((issue) => issue.code)).toEqual(expect.arrayContaining([
      "AGGREGATION_NOT_VERBATIM",
      "AGGREGATION_JUDGED_ARTIFACT_CHANGED"
    ]));
  });

  it("detects non-verbatim prose even when the selected Math answer survives", () => {
    const solver = "FINAL ANSWER: \\boxed{17}";
    const result = lintAggregationPreservation("math", solver, `summary\n${solver}`);
    expect(result.ok).toBe(false);
    expect(result.value).toMatchObject({ verbatim: false, judgedArtifactPreserved: true });
    expect(result.issues.map((issue) => issue.code)).toContain("AGGREGATION_NOT_VERBATIM");
  });
});
