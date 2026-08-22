# Experiment ledger

The experiment ledger stores completed, attributable calibration results. Raw AI:GO and portal evidence remains immutable in the ignored artifacts directory. Each normalized record is validated against `schemas/argus-experiment.schema.json` before it is appended as one JSON object per line. Existing lines are never rewritten by the CLI, and a duplicate `runId` is rejected.

This ledger is development evidence outside the judged path. It must not contain invented scores, inferred hidden answers, or a demo trace presented as model-performance evidence. Portal enums remain primary truth; `secondaryTags` and `failureClass` are diagnostic labels only.

## Commands

```bash
# Append one record or a JSON array of records. The input is secret-scanned first.
npm run argus -- experiment-append artifacts/experiments/calibration.jsonl artifacts/exports/records.json

# Summarize each candidate by track, stratum, repeat coverage, token/cost, latency,
# format failure, timeout, and context-duplication factor.
npm run argus -- calibration-report artifacts/experiments/calibration.jsonl

# Compare exact track/item/repeat pairs. A non-promotable candidate exits non-zero.
npm run argus -- promotion-check artifacts/experiments/calibration.jsonl ARGUS-C0 ARGUS-C1

# Optionally permit a measured stratum regression of at most 0.01.
npm run argus -- promotion-check artifacts/experiments/calibration.jsonl ARGUS-C0 ARGUS-C1 0.01
```

`weightedAccuracy` is emitted only when Coding, Math, and Generic all exist for the candidate. Coding receives weight `0.50`; Math and Generic receive `0.25` each. `weightedObservedAccuracy` is explicitly a partial, renormalized diagnostic and is not a substitute for the full benchmark-weighted score.

## Promotion gate

The automated gate is deliberately necessary-but-not-sufficient. It requires:

- the baseline and candidate to contain the same exact track/item/repeat sample;
- at least two distinct repeats for every paired item;
- no paired score regression and either higher mean accuracy or equal accuracy at lower total normalized cost;
- no increase in format failures or timeouts;
- no candidate `extraction_failed`, `capped`, grader error, infrastructure failure, or unknown terminal outcome;
- no stratum regression beyond the explicit threshold; and
- complete dataset, Squad, submission, and prompt hashes.

A passing report does not promote or mutate a Squad. A human still reviews the evidence and chooses whether to freeze the candidate.
