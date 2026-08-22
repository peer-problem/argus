import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { verifyHashManifest } from "./hash.ts";

describe("hash manifests", () => {
  it("verifies every tracked path in the candidate mapping", () => {
    const manifest = JSON.parse(readFileSync("configs/candidates/argus-c0.mapping.json", "utf8"));
    const result = verifyHashManifest(manifest);
    expect(result.ok).toBe(true);
    expect(result.value).toHaveLength(11);
  });

  it("rejects mismatches and paths outside the repository", () => {
    const result = verifyHashManifest({ artifacts: [
      { path: "prompts/math.md", sha256: "0".repeat(64) },
      { path: "../outside.txt", sha256: "0".repeat(64) }
    ] });
    expect(result.ok).toBe(false);
    expect(result.issues.map((issue) => issue.code)).toEqual(expect.arrayContaining(["MANIFEST_HASH_MISMATCH", "MANIFEST_PATH_OUTSIDE_ROOT"]));
  });
});
