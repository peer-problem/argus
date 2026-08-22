# ARGUS

ARGUS is a user-tool-free AI:GO Squad and a replayable execution observability app. The judged path stays entirely inside the native AI:GO Planner, task graph, model inference, and aggregation protocol. ARGUS Lab and ARGUS Trace operate outside that path on exported, read-only evidence.

## Compliance boundary

```text
Judge request
  → track one-shot prompt
  → native AI:GO Planner orchestration
  → one native task assigned to ARGUS Solver
  → model inference with no attached tools or memory
  → native answer selection: aggregated result first, then last-wave task output fallback
  → required final output
```

The judged path has no built-in tools, custom tools, MCP, shell, Python kernel, repository browser, search, external API, sidecar, or external model. The Planner may use only AI:GO's internal coordination functions. The Squad is created with **새로 만들기** and agents are added manually; template, import, and profile workflows are prohibited.

Local scripts are development and evidence tooling only. They compose public practice requests, validate outputs and configuration, normalize completed exports, calculate hashes/cost, and render read-only traces. They never answer a judged request or feed a result back into a running Squad.

## Virtual Kernel v1

ARGUS does not add a fake Kernel Agent. The Qwen3-32B Planner is a thin control driver that
creates exactly one lossless native task. The GPT-OSS-120B Solver is the only execution subject
and internally applies `Normalize → Solve → Assert → Repair at most once → Emit`. A valid artifact
is aggregated verbatim. The protocol exposes neither private reasoning nor fabricated tool/test
results; ARGUS Trace labels it as a configured contract, separate from observed events.

The official input+output context limits are Qwen 40K, GPT-OSS 128K, and K-EXAONE 48K. The
current v1 uses Qwen for fast planning and GPT-OSS for a conservative universal Solver envelope.
A 12,288-token output reserve is used only for local preflight; the free portal Check confirmed
that agent `settingsOverrides` do not reach evaluation and that event per-run caps are authoritative.
A Context Pager remains experimental: it cannot repair the installed 65,536-byte guard because
that guard rejects the request before any Squad agent receives it. Pager promotion requires
lossless native sequential delivery and a measured accuracy/cost Pareto gain.

## Repository map

- `configs/candidates/` — reviewable configuration plans; never presented as live proof
- `configs/candidates/argus-candidate-ladder.json` — schema-validated G0/C0–C3 plan; only C0 is currently testing
- `configs/frozen/` — generated only after evidence gates pass
- `prompts/` — the three submitted one-shot prompts
- `practice/manifests/calibration-plan.json` — hash-bound three-model/item matrix with `liveRuns: 0`
- `lab/` — request composer, validators, importers, event ledger, and reports
- `schemas/` — normalized event and run contracts
- `apps/argus-trace/` — interactive replay and comparison app
- `artifacts/` — ignored locations for AI:GO workspaces, exports, and run evidence

ARGUS Trace uses a local interface system with angular 1px surfaces, a 4px spacing scale,
32px controls, light/dark tokens, and `@base-ui/react` compound primitives for tabs,
selects, sliders, progress, tooltips, buttons, and toast feedback. State labels and
accessible names remain authoritative; color is only a secondary cue.

## Commands

```bash
npm install
npm run handoff
npm run validate
npm run dev

# Reproduce portal request composition.
npm run argus -- compose prompts/math.md request.txt math > composed.txt

# Recalculate all visible Coding items against the direct request guard.
npm run report:coverage

# Estimate conservative input+output context envelopes and cheapest safe model candidates.
npm run report:context

# Verify that G0/C0–C3 remain plan-only and evidence-gated where required.
npm run argus -- lint-ladder configs/candidates/argus-candidate-ladder.json

# Validate the final output extracted by a track grader.
npm run argus -- lint-output coding output.txt request.txt

# Detect byte drift or grader-artifact corruption across native aggregation.
npm run argus -- lint-aggregation coding solver.txt aggregated.txt request.txt

# Prove that a SWE request survives Planner task creation and Solver delivery losslessly.
npm run argus -- lint-swe-fidelity request.txt planner-task.txt solver-input.txt

# Normalize a completed export into an append-only event ledger.
npm run argus -- import portal artifacts/exports/run-details.json artifacts/runs/run.json

# Reconcile portal grading truth with AI:GO orchestration evidence.
npm run argus -- reconcile artifacts/runs/portal.json artifacts/runs/aigo.json artifacts/runs/merged.json

# Append completed calibration evidence and produce a candidate/stratum report.
npm run argus -- experiment-append artifacts/experiments/calibration.jsonl artifacts/exports/records.json
npm run argus -- calibration-report artifacts/experiments/calibration.jsonl

# Enforce the paired, repeated accuracy/cost promotion gate (non-zero on failure).
npm run argus -- promotion-check artifacts/experiments/calibration.jsonl ARGUS-C0 ARGUS-C1

# Verify every tracked prompt/config checksum.
npm run argus -- verify-manifest configs/candidates/argus-c0.mapping.json

# Inspect the gate report. This never performs a submission.
npm run argus -- audit configs/candidates/argus-c0.plan.json
```

`npm run handoff` is the receiving-team acceptance command. It must report
`codebaseReady: true`; `submissionReady` may remain false while live model, portal,
calibration, freeze, and submission work is intentionally deferred. See
[`docs/phase-1/HANDOFF.md`](docs/phase-1/HANDOFF.md).

## Evidence status

The codebase is complete for team handoff: `npm run handoff` proves the required repository
topology, local contracts, hashes, secret boundary, tests, and production build. The current
candidate remains **unfrozen but active** because codebase readiness is intentionally separate
from submission readiness. The live two-agent snapshot, Virtual Kernel prompts, Qwen→GPT model
route, official context-policy lint, and delivery hashes are locally reproducible. The optimized
552-byte Coding prompt makes 11 of 20 visible Coding requests fit the installed AI:GO v1.12.1
65,536-byte request guard; nine remain oversized on that direct surface. Portal-published request
pages resolve answer provenance: Execution Progress and the judge read the same result field;
extraction tries aggregated result first, then last-wave task outputs backwards, and refuses the
deterministic execution summary. Coding/Generic runtime format, caps, score, and accuracy are
deferred live validation. Hashed records are under `configs/candidates/evidence/`.

Final portal submission is deliberately outside all scripts. It requires a human to review frozen hashes, cost, and queue state and then submit once.

See [the team handoff](docs/phase-1/HANDOFF.md), [implementation status](docs/phase-1/IMPLEMENTATION.md), [completion audit](docs/phase-1/COMPLETION-AUDIT.md), [runbook](docs/phase-1/RUNBOOK.md), [compliance evidence](docs/phase-1/COMPLIANCE.md), and [Phase 1 PRD](docs/phase-1/PRD.md).
