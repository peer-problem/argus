import { REQUIRED_OUTPUT, stripTrailingWhitespace, TASK_PLACEHOLDER } from "./compose.ts";

export interface CodingRequestItem {
  itemId: string;
  kind: "swebench" | "livecodebench";
  sourceBytes: number;
  normalizedTaskBytes: number;
  sha256: string;
}

export interface CodingRequestManifest {
  schemaVersion: number;
  source: string;
  baseUrl: string;
  capturedAt: string;
  items: CodingRequestItem[];
}

export interface CodingCoverageRow extends CodingRequestItem {
  composedBytes: number;
  marginBytes: number;
  fits: boolean;
}

export interface CodingCoverageReport {
  maximumAllowedBytes: number;
  promptBytes: number;
  staticPromptBytes: number;
  requiredOutputBytes: number;
  composedOverheadBytes: number;
  sourceAtOrBelowLimit: number;
  sourceOverLimit: number;
  composedAtOrBelowLimit: number;
  composedOverLimit: number;
  rows: CodingCoverageRow[];
}

function assertCodingManifest(value: CodingRequestManifest): void {
  if (value.schemaVersion !== 1 || !Array.isArray(value.items) || value.items.length === 0) {
    throw new Error("Coding request manifest must be schemaVersion 1 with at least one item.");
  }
  const seen = new Set<string>();
  for (const item of value.items) {
    if (!/^coding-visible-\d{4}$/.test(item.itemId) || seen.has(item.itemId)) throw new Error(`Invalid or duplicate Coding item ID: ${item.itemId}`);
    if (!Number.isInteger(item.sourceBytes) || !Number.isInteger(item.normalizedTaskBytes) || item.sourceBytes <= 0 || item.normalizedTaskBytes <= 0 || item.normalizedTaskBytes > item.sourceBytes) {
      throw new Error(`Invalid byte counts for ${item.itemId}.`);
    }
    if (!/^[a-f0-9]{64}$/.test(item.sha256)) throw new Error(`Invalid SHA-256 for ${item.itemId}.`);
    seen.add(item.itemId);
  }
}

export function calculateCodingCoverage(prompt: string, manifest: CodingRequestManifest, maximumAllowedBytes = 65_536): CodingCoverageReport {
  assertCodingManifest(manifest);
  if (!Number.isInteger(maximumAllowedBytes) || maximumAllowedBytes <= 0) throw new Error("maximumAllowedBytes must be a positive integer.");
  const cleanPrompt = stripTrailingWhitespace(prompt);
  const placeholderCount = cleanPrompt.split(TASK_PLACEHOLDER).length - 1;
  if (placeholderCount !== 1) throw new Error(`Coding prompt must contain exactly one ${TASK_PLACEHOLDER}.`);
  const staticPromptBytes = Buffer.byteLength(cleanPrompt.replace(TASK_PLACEHOLDER, ""), "utf8");
  const requiredOutputBytes = Buffer.byteLength(stripTrailingWhitespace(REQUIRED_OUTPUT.coding), "utf8");
  const composedOverheadBytes = staticPromptBytes + 2 + requiredOutputBytes + 1;
  const rows = manifest.items.map((item) => {
    const composedBytes = item.normalizedTaskBytes + composedOverheadBytes;
    const marginBytes = maximumAllowedBytes - composedBytes;
    return { ...item, composedBytes, marginBytes, fits: marginBytes >= 0 };
  });
  return {
    maximumAllowedBytes,
    promptBytes: Buffer.byteLength(prompt, "utf8"),
    staticPromptBytes,
    requiredOutputBytes,
    composedOverheadBytes,
    sourceAtOrBelowLimit: rows.filter((row) => row.sourceBytes <= maximumAllowedBytes).length,
    sourceOverLimit: rows.filter((row) => row.sourceBytes > maximumAllowedBytes).length,
    composedAtOrBelowLimit: rows.filter((row) => row.fits).length,
    composedOverLimit: rows.filter((row) => !row.fits).length,
    rows
  };
}
