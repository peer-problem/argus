import type { PortalBatchRunReport } from "../types.ts";

function report(value: Omit<PortalBatchRunReport, "source" | "evidence"> & { receivedAt: string }): PortalBatchRunReport {
  const { receivedAt, ...fields } = value;
  return {
    ...fields,
    source: "portal",
    evidence: {
      protocol: "Run-details JSON export",
      receivedAt,
      reference: `demo://portal/${fields.reportId}.json`
    }
  };
}

export const demoPortalReports: PortalBatchRunReport[] = [
  report({
    reportId: "portal-test-hidden-20260822-0455",
    team: "test",
    runName: "test-hidden",
    status: "completed",
    score: 0.093,
    scoredItems: 73,
    totalItems: 74,
    executionTimeMs: 2_998_000,
    tokens: { input: 1_974_967, output: 768_715, total: 2_743_682 },
    caps: { wallClockSeconds: null, tokenLimit: null },
    postedAt: "2026-08-22T04:55:00.000Z",
    receivedAt: "2026-08-22T04:55:04.000Z",
    modelUsage: [
      { model: "furiosa-ai/Qwen3-32B-FP8", inputTokens: 373_223, outputTokens: 570_517, requests: 344, totalTokens: 943_740 },
      { model: "furiosa-ai/gpt-oss-120b", inputTokens: 1_601_744, outputTokens: 198_198, requests: 425, totalTokens: 1_799_942 }
    ],
    trackResults: [
      { track: "coding", accuracy: 0, graded: 15, items: 19, excluded: 1, weight: 0.5 },
      { track: "math", accuracy: 0.143, graded: 7, items: 7, excluded: 0, weight: 0.25 },
      { track: "generic", accuracy: 0.229, graded: 48, items: 48, excluded: 0, weight: 0.25 }
    ]
  }),
  report({
    reportId: "portal-argus-c5-20260822-0412",
    team: "argus-c5",
    runName: "hidden-r05",
    status: "completed",
    score: 0.51,
    scoredItems: 74,
    totalItems: 74,
    executionTimeMs: 2_346_000,
    tokens: { input: 1_420_000, output: 545_000, total: 1_965_000 },
    caps: { wallClockSeconds: 3_600, tokenLimit: 3_000_000 },
    postedAt: "2026-08-22T04:12:00.000Z",
    receivedAt: "2026-08-22T04:12:03.000Z",
    modelUsage: [
      { model: "furiosa-ai/Qwen3-32B-FP8", inputTokens: 300_000, outputTokens: 350_000, requests: 281, totalTokens: 650_000 },
      { model: "furiosa-ai/gpt-oss-120b", inputTokens: 1_120_000, outputTokens: 195_000, requests: 318, totalTokens: 1_315_000 }
    ],
    trackResults: [
      { track: "coding", accuracy: 0.42, graded: 19, items: 19, excluded: 0, weight: 0.5 },
      { track: "math", accuracy: 0.57, graded: 7, items: 7, excluded: 0, weight: 0.25 },
      { track: "generic", accuracy: 0.63, graded: 48, items: 48, excluded: 0, weight: 0.25 }
    ]
  }),
  report({
    reportId: "portal-argus-c4-20260822-0328",
    team: "argus-c4",
    runName: "hidden-r04",
    status: "completed",
    score: 0.46,
    scoredItems: 71,
    totalItems: 74,
    executionTimeMs: 3_264_000,
    tokens: { input: 2_660_000, output: 760_000, total: 3_420_000 },
    caps: { wallClockSeconds: 3_600, tokenLimit: 4_000_000 },
    postedAt: "2026-08-22T03:28:00.000Z",
    receivedAt: "2026-08-22T03:28:05.000Z",
    modelUsage: [
      { model: "furiosa-ai/Qwen3-32B-FP8", inputTokens: 430_000, outputTokens: 670_000, requests: 402, totalTokens: 1_100_000 },
      { model: "furiosa-ai/gpt-oss-120b", inputTokens: 2_230_000, outputTokens: 90_000, requests: 511, totalTokens: 2_320_000 }
    ],
    trackResults: [
      { track: "coding", accuracy: 0.35, graded: 17, items: 19, excluded: 1, weight: 0.5 },
      { track: "math", accuracy: 0.43, graded: 7, items: 7, excluded: 0, weight: 0.25 },
      { track: "generic", accuracy: 0.71, graded: 47, items: 48, excluded: 1, weight: 0.25 }
    ]
  }),
  report({
    reportId: "portal-argus-c3-20260822-0240",
    team: "argus-c3",
    runName: "hidden-r03",
    status: "completed",
    score: 0.5,
    scoredItems: 72,
    totalItems: 74,
    executionTimeMs: 2_682_000,
    tokens: { input: 1_470_000, output: 740_000, total: 2_210_000 },
    caps: { wallClockSeconds: null, tokenLimit: 3_000_000 },
    postedAt: "2026-08-22T02:40:00.000Z",
    receivedAt: "2026-08-22T02:40:04.000Z",
    modelUsage: [
      { model: "furiosa-ai/Qwen3-32B-FP8", inputTokens: 250_000, outputTokens: 530_000, requests: 337, totalTokens: 780_000 },
      { model: "furiosa-ai/gpt-oss-120b", inputTokens: 1_050_000, outputTokens: 120_000, requests: 292, totalTokens: 1_170_000 },
      { model: "furiosa-ai/K-EXAONE-236B-A23B-NVFP4A16", inputTokens: 170_000, outputTokens: 90_000, requests: 38, totalTokens: 260_000 }
    ],
    trackResults: [
      { track: "coding", accuracy: 0.58, graded: 18, items: 19, excluded: 1, weight: 0.5 },
      { track: "math", accuracy: 0.36, graded: 7, items: 7, excluded: 0, weight: 0.25 },
      { track: "generic", accuracy: 0.48, graded: 47, items: 48, excluded: 1, weight: 0.25 }
    ]
  }),
  report({
    reportId: "portal-argus-c2-20260822-0156",
    team: "argus-c2",
    runName: "hidden-r02",
    status: "completed",
    score: 0.46,
    scoredItems: 74,
    totalItems: 74,
    executionTimeMs: 3_588_000,
    tokens: { input: 1_020_000, output: 460_000, total: 1_480_000 },
    caps: { wallClockSeconds: 3_600, tokenLimit: null },
    postedAt: "2026-08-22T01:56:00.000Z",
    receivedAt: "2026-08-22T01:56:04.000Z",
    modelUsage: [
      { model: "furiosa-ai/Qwen3-32B-FP8", inputTokens: 240_000, outputTokens: 380_000, requests: 310, totalTokens: 620_000 },
      { model: "furiosa-ai/gpt-oss-120b", inputTokens: 780_000, outputTokens: 80_000, requests: 246, totalTokens: 860_000 }
    ],
    trackResults: [
      { track: "coding", accuracy: 0.21, graded: 19, items: 19, excluded: 0, weight: 0.5 },
      { track: "math", accuracy: 0.68, graded: 7, items: 7, excluded: 0, weight: 0.25 },
      { track: "generic", accuracy: 0.74, graded: 48, items: 48, excluded: 0, weight: 0.25 }
    ]
  }),
  report({
    reportId: "portal-argus-c1-20260822-0103",
    team: "argus-c1",
    runName: "hidden-r01",
    status: "completed",
    score: 0.59,
    scoredItems: 73,
    totalItems: 74,
    executionTimeMs: 2_178_000,
    tokens: { input: 2_040_000, output: 840_000, total: 2_880_000 },
    caps: { wallClockSeconds: null, tokenLimit: null },
    postedAt: "2026-08-22T01:03:00.000Z",
    receivedAt: "2026-08-22T01:03:03.000Z",
    modelUsage: [
      { model: "furiosa-ai/Qwen3-32B-FP8", inputTokens: 360_000, outputTokens: 720_000, requests: 390, totalTokens: 1_080_000 },
      { model: "furiosa-ai/gpt-oss-120b", inputTokens: 1_680_000, outputTokens: 120_000, requests: 472, totalTokens: 1_800_000 }
    ],
    trackResults: [
      { track: "coding", accuracy: 0.65, graded: 18, items: 19, excluded: 1, weight: 0.5 },
      { track: "math", accuracy: 0.51, graded: 7, items: 7, excluded: 0, weight: 0.25 },
      { track: "generic", accuracy: 0.55, graded: 48, items: 48, excluded: 0, weight: 0.25 }
    ]
  })
];
