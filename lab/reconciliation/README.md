# Evidence reconciliation

ARGUS keeps portal run details as grading truth and AI:GO history as orchestration evidence. Normalize each source, then reconcile the pair:

```bash
npm run argus -- import portal artifacts/exports/portal-run.json artifacts/runs/portal.normalized.json
npm run argus -- import aigo artifacts/exports/aigo-history.json artifacts/runs/aigo.normalized.json
npm run argus -- reconcile artifacts/runs/portal.normalized.json artifacts/runs/aigo.normalized.json artifacts/runs/merged.json
```

The merged run inherits portal score, outcome, caps, final answer, and model breakdown while retaining distinct AI:GO task and activity events. Missing portal fields remain unknown; reconciliation never promotes an AI:GO completion state to a grade.
