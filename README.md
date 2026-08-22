# ARGUS Trace

ARGUS is a frontend-only dashboard for replaying and comparing normalized execution runs. It visualizes observed events, task dependencies, agent swimlanes, token and latency usage, failures, evidence checks, and final-answer provenance.

The repository does not define an execution roster, model route, system instruction, track instruction, experiment plan, or trial workflow. The dashboard derives agents, roles, models, tasks, waves, checks, and artifact identities from each imported run so those values can change between runs without a frontend change.

ARGUS Trace uses a local interface system with angular surfaces, compact controls, light/dark tokens, and accessible compound primitives.

## Commands

```bash
npm install
npm run dev
npm test
npm run build
npm run validate
```

## Run input

Use **Import run** in the dashboard to load one normalized run object or an array of run objects as JSON. A run must include a string `runId`, an `events` array, `totals`, and `compliance`. Other visualization fields follow the interfaces in [`apps/argus-trace/src/types.ts`](apps/argus-trace/src/types.ts).

The bundled records under `apps/argus-trace/src/data/demo.ts` are synthetic rendering fixtures only.

## AI:GO fixture boundary

`apps/argus-trace/src/data-sources/` isolates Squad observation data from the
dashboard UI. `FixtureDataSource` reads an extracted local AI:GO workspace via
the browser File API; it does not use HTTP or fabricate executions. The same
`SquadObservabilityDataSource` interface is implemented by `TauriDataSource`
for the native app's IPC commands.

The real AI:GO bundle contains prompts, outputs, errors, and local paths. Do
not copy it into this repository. Tests use only a small, sanitized in-memory
fixture. The folder-picker UI that connects the source to Trace is a subsequent
implementation step.

When a local, read-only bundle is available, its adapter contract can be
checked without placing it in Git:

```bash
cd "/path/to/Argus"
AIGO_FIXTURE_ROOT="/path/to/AIGO-visualization-real-logs" npm test -- fixture.contract.test.ts
```

## Repository map

- `apps/argus-trace/src/` — React dashboard, local types, derivations, and tests
- `apps/argus-trace/src/data/demo.ts` — synthetic UI fixture data
- `apps/argus-trace/src/data-sources/` — source-neutral AI:GO fixture and Tauri adapters
- `tests/fixture.contract.test.ts` — optional local AI:GO bundle contract check
- `apps/argus-trace/vite.config.ts` — Vite application configuration
- `vitest.config.ts` — frontend test configuration
