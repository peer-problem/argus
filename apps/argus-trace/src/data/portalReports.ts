import type { PortalBatchRunReport } from "../types.ts";

type ReportInput = Omit<PortalBatchRunReport, "source" | "evidence"> & {
  receivedAt: string | null;
  evidenceProtocol?: PortalBatchRunReport["evidence"]["protocol"];
  evidenceReference?: string;
};

function report(value: ReportInput): PortalBatchRunReport {
  const { receivedAt, evidenceProtocol = "Run-details JSON export", evidenceReference, ...fields } = value;
  return {
    ...fields,
    source: "portal",
    evidence: {
      protocol: evidenceProtocol,
      receivedAt,
      reference: evidenceReference ?? `demo://portal/${fields.reportId}.json`
    }
  };
}

/** Portal reports transcribed from the supplied ranked-run captures. */
export const addedPortalReports: PortalBatchRunReport[] = [
  report({
    reportId: "portal-limitedbeannoodle-hidden-1b3906fa-20260822-2354",
    team: "LimitedBeanNoodle",
    runName: "limitedbeannoodle-hidden-1b3906fa",
    status: "completed",
    score: 0.406,
    scoredItems: 144,
    totalItems: 147,
    executionTimeMs: 774_000,
    tokens: { input: 2_206_728, output: 560_932, total: 2_767_660 },
    caps: { wallClockSeconds: null, tokenLimit: null },
    postedAt: "2026-08-22T23:54:00.000Z",
    receivedAt: null,
    evidenceProtocol: "Portal run detail capture",
    evidenceReference: "capture://portal/limitedbeannoodle-hidden-1b3906fa-20260822-2354",
    modelUsage: [
      { model: "furiosa-ai/gpt-oss-120b", inputTokens: 2_206_728, outputTokens: 560_932, requests: 566, totalTokens: 2_767_660 }
    ],
    trackResults: [
      { track: "coding", accuracy: 0.158, graded: 37, items: 38, excluded: 0, weight: 0.5 },
      { track: "math", accuracy: 0.538, graded: 11, items: 13, excluded: 0, weight: 0.25 },
      { track: "generic", accuracy: 0.77, graded: 96, items: 96, excluded: 0, weight: 0.25 }
    ]
  }),
  report({
    reportId: "portal-noonchcoach-hidden-90825d8d-20260822-1918",
    team: "Noonchcoach",
    runName: "noonchcoach-hidden-90825d8d",
    status: "completed",
    score: 0.35,
    scoredItems: 144,
    totalItems: 147,
    executionTimeMs: 524_000,
    tokens: { input: 1_845_542, output: 423_809, total: 2_269_351 },
    caps: { wallClockSeconds: null, tokenLimit: null },
    postedAt: "2026-08-22T19:18:00.000Z",
    receivedAt: null,
    evidenceProtocol: "Portal run detail capture",
    evidenceReference: "capture://portal/noonchcoach-hidden-90825d8d-20260822-1918",
    modelUsage: [
      { model: "furiosa-ai/gpt-oss-120b", inputTokens: 1_845_542, outputTokens: 423_809, requests: 539, totalTokens: 2_269_351 }
    ],
    trackResults: [
      { track: "coding", accuracy: 0.105, graded: 36, items: 38, excluded: 0, weight: 0.5 },
      { track: "math", accuracy: 0.462, graded: 12, items: 13, excluded: 0, weight: 0.25 },
      { track: "generic", accuracy: 0.729, graded: 96, items: 96, excluded: 0, weight: 0.25 }
    ]
  }),
  report({
    reportId: "portal-couchpotato-hidden-c9f31618-20260822-1754",
    team: "CouchPotato",
    runName: "couchpotato-hidden-c9f31618",
    status: "completed",
    score: 0.285,
    scoredItems: 146,
    totalItems: 147,
    executionTimeMs: 688_000,
    tokens: { input: 2_294_626, output: 563_661, total: 2_858_287 },
    caps: { wallClockSeconds: null, tokenLimit: null },
    postedAt: "2026-08-22T17:54:00.000Z",
    receivedAt: null,
    evidenceProtocol: "Portal run detail capture",
    evidenceReference: "capture://portal/couchpotato-hidden-c9f31618-20260822-1754",
    modelUsage: [
      { model: "furiosa-ai/gpt-oss-120b", inputTokens: 2_294_626, outputTokens: 563_661, requests: 802, totalTokens: 2_858_287 }
    ],
    trackResults: [
      { track: "coding", accuracy: 0.158, graded: 37, items: 38, excluded: 0, weight: 0.5 },
      { track: "math", accuracy: 0.538, graded: 13, items: 13, excluded: 0, weight: 0.25 },
      { track: "generic", accuracy: 0.287, graded: 96, items: 96, excluded: 0, weight: 0.25 }
    ]
  }),
  report({
    reportId: "portal-demodaycare-hidden-bce040e5-20260822-1720",
    team: "DemoDayCare",
    runName: "demodaycare-hidden-bce040e5",
    status: "completed",
    score: 0.393,
    scoredItems: 146,
    totalItems: 147,
    executionTimeMs: 683_000,
    tokens: { input: 1_250_739, output: 514_142, total: 1_764_881 },
    caps: { wallClockSeconds: null, tokenLimit: null },
    postedAt: "2026-08-22T17:20:00.000Z",
    receivedAt: null,
    evidenceProtocol: "Portal run detail capture",
    evidenceReference: "capture://portal/demodaycare-hidden-bce040e5-20260822-1720",
    modelUsage: [
      { model: "furiosa-ai/Qwen3-32B-FP8", inputTokens: 126_534, outputTokens: 293_098, requests: 112, totalTokens: 419_632 },
      { model: "furiosa-ai/gpt-oss-120b", inputTokens: 1_124_205, outputTokens: 221_044, requests: 147, totalTokens: 1_345_249 }
    ],
    trackResults: [
      { track: "coding", accuracy: 0.211, graded: 38, items: 38, excluded: 0, weight: 0.5 },
      { track: "math", accuracy: 0.462, graded: 12, items: 13, excluded: 0, weight: 0.25 },
      { track: "generic", accuracy: 0.689, graded: 96, items: 96, excluded: 0, weight: 0.25 }
    ]
  }),
  report({
    reportId: "portal-couchpotato-hidden-cf5ccb29-20260822-1718",
    team: "CouchPotato",
    runName: "couchpotato-hidden-cf5ccb29",
    status: "completed",
    score: 0.045,
    scoredItems: 147,
    totalItems: 147,
    executionTimeMs: 556_000,
    tokens: { input: 4_848_875, output: 519_605, total: 5_368_480 },
    caps: { wallClockSeconds: null, tokenLimit: null },
    postedAt: "2026-08-22T17:18:00.000Z",
    receivedAt: null,
    evidenceProtocol: "Portal run detail capture",
    evidenceReference: "capture://portal/couchpotato-hidden-cf5ccb29-20260822-1718",
    modelUsage: [
      { model: "furiosa-ai/gpt-oss-120b", inputTokens: 4_848_875, outputTokens: 519_605, requests: 1_573, totalTokens: 5_368_480 }
    ],
    trackResults: [
      { track: "coding", accuracy: 0, graded: 38, items: 38, excluded: 0, weight: 0.5 },
      { track: "math", accuracy: 0, graded: 13, items: 13, excluded: 0, weight: 0.25 },
      { track: "generic", accuracy: 0.179, graded: 96, items: 96, excluded: 0, weight: 0.25 }
    ]
  })
];

/** Existing reports paired with the six synthetic sidebar fixtures. */
export const demoLinkedPortalReports: PortalBatchRunReport[] = [
  report({
    reportId: "portal-mishulta-hidden-8144245b-20260822-1549",
    team: "MISHULTA",
    runName: "mishulta-hidden-8144245b",
    status: "completed",
    score: 0.426,
    scoredItems: 145,
    totalItems: 147,
    executionTimeMs: 678_000,
    tokens: { input: 2_033_190, output: 496_359, total: 2_529_549 },
    caps: { wallClockSeconds: null, tokenLimit: null },
    postedAt: "2026-08-22T15:49:00.000Z",
    receivedAt: null,
    evidenceProtocol: "Portal run detail capture",
    evidenceReference: "capture://portal/mishulta-hidden-8144245b-20260822-1549",
    modelUsage: [
      { model: "furiosa-ai/gpt-oss-120b", inputTokens: 2_033_190, outputTokens: 496_359, requests: 327, totalTokens: 2_529_549 }
    ],
    trackResults: [
      { track: "coding", accuracy: 0.211, graded: 37, items: 38, excluded: 0, weight: 0.5 },
      { track: "math", accuracy: 0.538, graded: 12, items: 13, excluded: 0, weight: 0.25 },
      { track: "generic", accuracy: 0.745, graded: 96, items: 96, excluded: 0, weight: 0.25 }
    ]
  }),
  report({
    reportId: "portal-theresnofree-hidden-20260822-1159",
    team: "TheresNoFree",
    runName: "theresnofree-hidden",
    status: "completed",
    score: 0.403,
    scoredItems: 147,
    totalItems: 147,
    executionTimeMs: 2_434_000,
    tokens: { input: 732_306, output: 602_207, total: 1_334_513 },
    caps: { wallClockSeconds: null, tokenLimit: null },
    postedAt: "2026-08-22T11:59:00.000Z",
    receivedAt: null,
    evidenceProtocol: "Portal run detail capture",
    evidenceReference: "capture://portal/theresnofree-hidden-20260822-1159",
    modelUsage: [
      { model: "furiosa-ai/K-EXAONE-236B-A23B-NVFP4A16", inputTokens: 52_861, outputTokens: 24_716, requests: 26, totalTokens: 77_577 },
      { model: "furiosa-ai/Qwen3-32B-FP8", inputTokens: 105_342, outputTokens: 332_714, requests: 111, totalTokens: 438_056 },
      { model: "furiosa-ai/gpt-oss-120b", inputTokens: 574_103, outputTokens: 244_777, requests: 142, totalTokens: 818_880 }
    ],
    trackResults: [
      { track: "coding", accuracy: 0.263, graded: 38, items: 38, excluded: 0, weight: 0.5 },
      { track: "math", accuracy: 0.385, graded: 13, items: 13, excluded: 0, weight: 0.25 },
      { track: "generic", accuracy: 0.702, graded: 96, items: 96, excluded: 0, weight: 0.25 }
    ]
  }),
  report({
    reportId: "portal-couchpotato-hidden-a8fd641c-20260822-1526",
    team: "CouchPotato",
    runName: "couchpotato-hidden-a8fd641c",
    status: "completed",
    score: 0.254,
    scoredItems: 144,
    totalItems: 147,
    executionTimeMs: 1_621_000,
    tokens: { input: 2_517_590, output: 1_092_162, total: 3_609_752 },
    caps: { wallClockSeconds: null, tokenLimit: null },
    postedAt: "2026-08-22T15:26:00.000Z",
    receivedAt: null,
    evidenceProtocol: "Portal run detail capture",
    evidenceReference: "capture://portal/couchpotato-hidden-a8fd641c-20260822-1526",
    modelUsage: [
      { model: "furiosa-ai/Qwen3-32B-FP8", inputTokens: 287_196, outputTokens: 516_974, requests: 203, totalTokens: 804_170 },
      { model: "furiosa-ai/gpt-oss-120b", inputTokens: 2_230_394, outputTokens: 575_188, requests: 431, totalTokens: 2_805_582 }
    ],
    trackResults: [
      { track: "coding", accuracy: 0.158, graded: 37, items: 38, excluded: 0, weight: 0.5 },
      { track: "math", accuracy: 0.231, graded: 12, items: 13, excluded: 0, weight: 0.25 },
      { track: "generic", accuracy: 0.471, graded: 95, items: 96, excluded: 0, weight: 0.25 }
    ]
  }),
  report({
    reportId: "portal-limitedbeannoodle-hidden-20260822-1319",
    team: "LimitedBeanNoodle",
    runName: "limitedbeannoodle-hidden",
    status: "completed",
    score: 0.253,
    scoredItems: 137,
    totalItems: 147,
    executionTimeMs: 2_138_000,
    tokens: { input: 1_511_452, output: 968_034, total: 2_479_486 },
    caps: { wallClockSeconds: null, tokenLimit: null },
    postedAt: "2026-08-22T13:19:00.000Z",
    receivedAt: null,
    evidenceProtocol: "Portal run detail capture",
    evidenceReference: "capture://portal/limitedbeannoodle-hidden-20260822-1319",
    modelUsage: [
      { model: "furiosa-ai/K-EXAONE-236B-A23B-NVFP4A16", inputTokens: 49_494, outputTokens: 14_199, requests: 8, totalTokens: 63_693 },
      { model: "furiosa-ai/Qwen3-32B-FP8", inputTokens: 913_696, outputTokens: 752_066, requests: 519, totalTokens: 1_665_762 },
      { model: "furiosa-ai/gpt-oss-120b", inputTokens: 548_262, outputTokens: 201_769, requests: 114, totalTokens: 750_031 }
    ],
    trackResults: [
      { track: "coding", accuracy: 0.184, graded: 37, items: 38, excluded: 0, weight: 0.5 },
      { track: "math", accuracy: 0.308, graded: 12, items: 13, excluded: 0, weight: 0.25 },
      { track: "generic", accuracy: 0.337, graded: 88, items: 96, excluded: 0, weight: 0.25 }
    ]
  }),
  report({
    reportId: "portal-couchpotato-hidden-20260822-1235",
    team: "CouchPotato",
    runName: "couchpotato-hidden",
    status: "completed",
    score: 0.186,
    scoredItems: 147,
    totalItems: 147,
    executionTimeMs: 1_222_000,
    tokens: { input: 2_435_060, output: 946_526, total: 3_381_586 },
    caps: { wallClockSeconds: null, tokenLimit: null },
    postedAt: "2026-08-22T12:35:00.000Z",
    receivedAt: null,
    evidenceProtocol: "Portal run detail capture",
    evidenceReference: "capture://portal/couchpotato-hidden-20260822-1235",
    modelUsage: [
      { model: "furiosa-ai/Qwen3-32B-FP8", inputTokens: 336_174, outputTokens: 459_947, requests: 219, totalTokens: 796_121 },
      { model: "furiosa-ai/gpt-oss-120b", inputTokens: 2_098_886, outputTokens: 486_579, requests: 327, totalTokens: 2_585_465 }
    ],
    trackResults: [
      { track: "coding", accuracy: 0.184, graded: 38, items: 38, excluded: 0, weight: 0.5 },
      { track: "math", accuracy: 0.077, graded: 13, items: 13, excluded: 0, weight: 0.25 },
      { track: "generic", accuracy: 0.298, graded: 96, items: 96, excluded: 0, weight: 0.25 }
    ]
  }),
  report({
    reportId: "portal-maketheworldbetter-hidden-20260822-1342",
    team: "MakeTheWorldBetter",
    runName: "maketheworldbetter-hidden",
    status: "completed",
    score: 0.17,
    scoredItems: 146,
    totalItems: 147,
    executionTimeMs: 887_000,
    tokens: { input: 4_430_469, output: 950_912, total: 5_381_381 },
    caps: { wallClockSeconds: null, tokenLimit: null },
    postedAt: "2026-08-22T13:42:00.000Z",
    receivedAt: null,
    evidenceProtocol: "Portal run detail capture",
    evidenceReference: "capture://portal/maketheworldbetter-hidden-20260822-1342",
    modelUsage: [
      { model: "furiosa-ai/gpt-oss-120b", inputTokens: 4_430_469, outputTokens: 950_912, requests: 1_464, totalTokens: 5_381_381 }
    ],
    trackResults: [
      { track: "coding", accuracy: 0.026, graded: 37, items: 38, excluded: 0, weight: 0.5 },
      { track: "math", accuracy: 0.385, graded: 13, items: 13, excluded: 0, weight: 0.25 },
      { track: "generic", accuracy: 0.244, graded: 96, items: 96, excluded: 0, weight: 0.25 }
    ]
  })
];

export const capturedPortalReports: PortalBatchRunReport[] = [...addedPortalReports, ...demoLinkedPortalReports];
