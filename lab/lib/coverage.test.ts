import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { calculateCodingCoverage, type CodingRequestManifest } from "./coverage.ts";

const prompt = readFileSync("prompts/coding.md", "utf8");
const manifest = JSON.parse(readFileSync("practice/manifests/coding-visible.requests.json", "utf8")) as CodingRequestManifest;

describe("Coding request coverage", () => {
  it("reproduces the item-level direct request matrix", () => {
    const report = calculateCodingCoverage(prompt, manifest);
    expect(report).toMatchObject({
      maximumAllowedBytes: 65_536,
      promptBytes: 552,
      requiredOutputBytes: 819,
      composedAtOrBelowLimit: 11,
      composedOverLimit: 9,
      sourceAtOrBelowLimit: 12,
      sourceOverLimit: 8
    });
    expect(report.rows.find((row) => row.itemId === "coding-visible-0031")).toMatchObject({ composedBytes: 65_507, marginBytes: 29, fits: true });
    expect(report.rows.find((row) => row.itemId === "coding-visible-0029")).toMatchObject({ composedBytes: 66_286, marginBytes: -750, fits: false });
  });

  it("rejects duplicate or malformed manifest entries", () => {
    const invalid = structuredClone(manifest);
    invalid.items[1]!.itemId = invalid.items[0]!.itemId;
    expect(() => calculateCodingCoverage(prompt, invalid)).toThrow(/duplicate Coding item ID/);
  });
});
