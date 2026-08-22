# ARGUS Trace

ARGUS is a frontend-only dashboard for replaying and comparing normalized execution runs. It visualizes observed events, task dependencies, agent swimlanes, token and latency usage, failures, evidence checks, and final-answer provenance.

The repository does not define an execution roster, model route, system instruction, track instruction, experiment plan, or trial workflow. The dashboard derives agents, roles, models, tasks, waves, checks, and artifact identities from each imported run so those values can change between runs without a frontend change.

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

## Repository map

- `apps/argus-trace/src/` — React dashboard, local types, derivations, and tests
- `apps/argus-trace/src/data/demo.ts` — synthetic UI fixture data
- `apps/argus-trace/vite.config.ts` — Vite application configuration
- `vitest.config.ts` — frontend test configuration
