import { Collapsible } from "@base-ui/react/collapsible";
import { Toast } from "@base-ui/react/toast";
import { Tooltip } from "@base-ui/react/tooltip";
import { CheckCircle2, ChevronLeft, ChevronRight, GitCompareArrows, Import, Radar, TriangleAlert } from "lucide-react";
import { lazy, Suspense, useEffect, useMemo, useRef, useState } from "react";
import type { ArgusBatch, ArgusBatchItem, ArgusEvent, ArgusRun } from "./types.ts";
import { DataArrivalFlow, RunSignals, TokenFlow } from "./components/AnalysisViews.tsx";
import { isArgusRun } from "./contracts.ts";
import { ExecutionTrace } from "./components/ExecutionTrace.tsx";
import { Inspector } from "./components/Inspector.tsx";
import { UiButton, UiToastViewport } from "./components/ui/Controls.tsx";
import { demoBatches, demoRuns, makeImportedBatch } from "./data/demo.ts";
import { demoPortalReports } from "./data/portalReports.ts";
import { capShare, dependencyWaveCount, finalAnswerPreview, formatDuration, formatNumber, taskCount, timelineDuration, visibleEvents } from "./derive.ts";

type View = "details" | "compare";

const CompareRuns = lazy(() => import("./components/CompareRuns.tsx").then((module) => ({ default: module.CompareRuns })));

function StatusMark({ run }: { run: ArgusRun }) {
  const Icon = run.status === "completed" ? CheckCircle2 : TriangleAlert;
  return <span className={`status-mark status-${run.status}`}><Icon size={14} aria-hidden="true" />Execution · {run.status.replaceAll("_", " ")}</span>;
}

function PortalMark({ run }: { run: ArgusRun }) {
  const passed = run.outcome === "graded";
  const unknown = run.outcome === "unknown";
  const Icon = passed ? CheckCircle2 : TriangleAlert;
  return <span className={`status-mark status-${unknown ? "unknown" : passed ? "completed" : "failed"}`}><Icon size={14} aria-hidden="true" />Portal · {run.outcome.replaceAll("_", " ")}</span>;
}

function displayRunId(runId: string): string {
  return runId.length > 26 ? `${runId.slice(0, 6)}…${runId.slice(-4)}` : runId;
}

function runTimestamp(run: ArgusRun): number {
  return new Date(run.events.at(-1)?.timestamp ?? run.importedAt).valueOf();
}

function runClock(run: ArgusRun): string {
  return new Intl.DateTimeFormat("en", { month: "short", day: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false }).format(runTimestamp(run));
}

const initialDemoRun = [...demoRuns].sort((a, b) => runTimestamp(b) - runTimestamp(a))[0]!;

function conciseRunWarning(run: ArgusRun): string | null {
  if (run.outcome === "extraction_failed") return "Required final-answer format was not met.";
  if (run.status === "capped") return "Run stopped at its configured limit.";
  if (run.status === "failed" || run.failure) return "Run failed before a final answer was accepted.";
  return null;
}

function Overview({ run }: { run: ArgusRun }) {
  const finalAnswer = run.finalAnswer?.trim() ?? "";
  const facts = [
    ["Score", run.score == null ? "—" : `${Math.round(run.score * 100)}%`],
    ["Tokens", formatNumber(run.caps.usedTokens, 0)],
    ["Duration", formatDuration(run.totals.latencyMs)],
    ["Cost", formatNumber(run.totals.normalizedCost, 0)]
  ];
  const warning = conciseRunWarning(run);
  return (
    <header className="run-overview">
      <div className="run-title-block">
        <div className="run-title-line"><h1 title={run.runId}>{displayRunId(run.runId)}</h1><div className="run-statuses"><StatusMark run={run} /><PortalMark run={run} /></div></div>
        {warning && <p className="run-failure-summary" role="alert"><TriangleAlert size={14} aria-hidden="true" /><span>{warning}</span></p>}
        {finalAnswer ? <Collapsible.Root className="final-answer-collapsible">
          <Collapsible.Trigger className="final-answer-trigger">
            <span>Final answer</span><code>{finalAnswerPreview(run.finalAnswer)}</code><ChevronRight className="final-answer-icon" size={15} aria-hidden="true" />
          </Collapsible.Trigger>
          <Collapsible.Panel className="final-answer-panel"><pre>{run.finalAnswer}</pre></Collapsible.Panel>
        </Collapsible.Root> : <div className="final-answer-empty"><span>Final answer</span><code>Not observed</code></div>}
      </div>
      <dl className="overview-facts" aria-label="Run summary">
        {facts.map(([label, value]) => <div key={label}><dt>{label}</dt><dd>{value}</dd></div>)}
      </dl>
    </header>
  );
}

function settingLabel(value: number | null, suffix = ""): string {
  return value == null ? "Unknown" : `${formatNumber(value, 0)}${suffix}`;
}

function RunLimits({ batch, item }: { batch: ArgusBatch; item: ArgusBatchItem }) {
  const observedTasks = taskCount(item.trace);
  const overTaskLimit = batch.settings.maxTasks != null && observedTasks > batch.settings.maxTasks;
  const settings = [
    ["Task limit", settingLabel(batch.settings.maxTasks), `${observedTasks} observed`],
    ["Concurrency", settingLabel(batch.settings.maxConcurrentTasks), "maximum"],
    ["Task timeout", settingLabel(batch.settings.taskTimeoutSeconds, " s"), "configured"],
    ["Request limit", settingLabel(batch.settings.directRequestByteLimit, " B"), "direct request"],
    ["Imported runs", `${batch.items.length}`, "same evidence set"]
  ];
  return (
    <section className="run-limits" aria-labelledby="run-limits-title">
      <h2 id="run-limits-title">Run limits</h2>
      <dl>
        {settings.map(([label, value, note]) => <div key={label} className={label === "Task limit" && overTaskLimit ? "is-violated" : ""}><dt>{label}</dt><dd>{value}</dd><small>{note}</small></div>)}
      </dl>
    </section>
  );
}

function AuditDetails({ batch, item, loadedAt }: { batch: ArgusBatch; item: ArgusBatchItem; loadedAt: string }) {
  const run = item.trace;
  const cap = capShare(run);
  const checks = Object.values(run.compliance).filter((value) => value === true).length;
  return (
    <Collapsible.Root className="audit-details">
      <Collapsible.Trigger className="audit-details-trigger">
        <span className="audit-details-title"><strong>Audit details</strong><small>Limits, compliance, provenance</small></span>
        <span className="audit-details-summary">
          {run.failure && <b className="audit-danger">Failure recorded</b>}
          <b>{cap == null ? "Cap unknown" : `${Math.round(cap * 100)}% cap`}</b>
          <b>{checks}/{Object.keys(run.compliance).length} checks</b>
          <ChevronRight className="audit-details-icon" size={16} aria-hidden="true" />
        </span>
      </Collapsible.Trigger>
      <Collapsible.Panel className="audit-details-panel">
        <div className="audit-details-content">
          <RunSignals run={run} />
          <RunLimits batch={batch} item={item} />
          <div className="lower-analysis"><TokenFlow run={run} /><DataArrivalFlow item={item} loadedAt={loadedAt} /></div>
        </div>
      </Collapsible.Panel>
    </Collapsible.Root>
  );
}

function AppContent() {
  const initialLoadedAt = useRef(new Date().toISOString());
  const [batches, setBatches] = useState<ArgusBatch[]>(demoBatches);
  const [loadedAtByRunId, setLoadedAtByRunId] = useState<Record<string, string>>(() => Object.fromEntries(demoRuns.map((item) => [item.runId, initialLoadedAt.current])));
  const [selectedBatchId, setSelectedBatchId] = useState(demoBatches[0]!.batchId);
  const [selectedRunId, setSelectedRunId] = useState(initialDemoRun.runId);
  const [selectedCompareReportId, setSelectedCompareReportId] = useState(demoPortalReports[0]?.reportId ?? "");
  const [view, setView] = useState<View>("compare");
  const [progress, setProgress] = useState(1);
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState(1);
  const [selectedEventId, setSelectedEventId] = useState<string | null>(initialDemoRun.events.at(-1)!.eventId);
  const [evidenceOpen, setEvidenceOpen] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const toastManager = Toast.useToastManager();
  const batch = batches.find((candidate) => candidate.batchId === selectedBatchId) ?? batches[0]!;
  const item = batch.items.find((candidate) => candidate.trace.runId === selectedRunId) ?? batch.items[0]!;
  const run = item.trace;
  const latestItems = useMemo(() => batches.flatMap((candidateBatch) => candidateBatch.items.map((candidateItem) => ({ batch: candidateBatch, item: candidateItem }))).sort((a, b) => runTimestamp(b.item.trace) - runTimestamp(a.item.trace)), [batches]);
  const compareSelectionIndex = Math.max(0, demoPortalReports.findIndex((report) => report.reportId === selectedCompareReportId));
  const activeListIndex = latestItems.length ? compareSelectionIndex % latestItems.length : -1;
  const revealed = useMemo(() => visibleEvents(run.events, progress, timelineDuration(run)), [run, progress]);
  const selectedEvent = run.events.find((event) => event.eventId === selectedEventId) ?? revealed.at(-1) ?? null;

  useEffect(() => {
    if (!playing) return;
    const timer = window.setInterval(() => setProgress((current) => {
      const next = current + 0.0125 * speed;
      if (next >= 1) {
        setPlaying(false);
        return 1;
      }
      return next;
    }), 100);
    return () => window.clearInterval(timer);
  }, [playing, speed]);

  useEffect(() => {
    const latest = visibleEvents(run.events, progress, timelineDuration(run)).at(-1);
    if (playing && latest) setSelectedEventId(latest.eventId);
  }, [playing, progress, run]);

  function activateRun(batchId: string, id: string) {
    const nextBatch = batches.find((candidate) => candidate.batchId === batchId);
    const nextRuns = nextBatch?.items.map((candidate) => candidate.trace) ?? [];
    const next = nextRuns.find((candidate) => candidate.runId === id);
    if (!nextBatch || !next) return;
    setSelectedBatchId(batchId);
    setSelectedRunId(id);
    setProgress(1);
    setPlaying(false);
    setSelectedEventId(next.events.at(-1)?.eventId ?? null);
    setEvidenceOpen(false);
    setView("details");
  }

  function openCompare() {
    setView("compare");
  }

  function toggleRunDetail(batchId: string, id: string, listIndex: number) {
    if (view === "details" && batchId === selectedBatchId && id === selectedRunId) {
      openCompare();
      return;
    }
    const linkedReport = demoPortalReports[listIndex % demoPortalReports.length];
    if (linkedReport) setSelectedCompareReportId(linkedReport.reportId);
    activateRun(batchId, id);
  }

  async function importEvidence(file: File) {
    try {
      const parsed: unknown = JSON.parse(await file.text());
      const incoming = Array.isArray(parsed) ? parsed : [parsed];
      if (incoming.length === 0 || !incoming.every(isArgusRun)) throw new Error("Use compatible ARGUS run JSON. Adapt raw source evidence before loading it into Trace.");
      const first = incoming[0]!;
      const loadedAt = new Date().toISOString();
      const importedBatch = makeImportedBatch(incoming, loadedAt);
      setBatches((current) => [importedBatch, ...current.filter((existing) => existing.batchId !== importedBatch.batchId)]);
      setLoadedAtByRunId((current) => ({ ...current, ...Object.fromEntries(incoming.map((item) => [item.runId, loadedAt])) }));
      setSelectedBatchId(importedBatch.batchId);
      setSelectedRunId(first.runId);
      setProgress(1);
      setPlaying(false);
      setSelectedEventId(first.events.at(-1)?.eventId ?? null);
      setEvidenceOpen(false);
      setView("details");
      toastManager.add({ title: "Evidence imported", description: `${incoming.length} run${incoming.length === 1 ? "" : "s"} added.` });
    } catch (error) {
      toastManager.add({ title: "Import failed", description: (error as Error).message, type: "error" });
    }
  }

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="brand"><span className="brand-mark"><Radar size={19} aria-hidden="true" /></span><span className="brand-copy"><strong>ARGUS</strong></span></div>
        <div className="sidebar-action">
          <UiButton variant={view === "compare" ? "primary" : "quiet"} type="button" onClick={openCompare}><GitCompareArrows size={16} aria-hidden="true" />Compare runs</UiButton>
        </div>
        <section className="run-index" aria-labelledby="run-index-title">
          <div className="run-index-head"><strong id="run-index-title">Runs</strong><small>{latestItems.length}</small></div>
          <ol>
            {latestItems.map(({ batch: candidateBatch, item: candidateItem }, listIndex) => {
              const candidate = candidateItem.trace;
              const active = listIndex === activeListIndex;
              const detailOpen = view === "details" && candidate.runId === run.runId && candidateBatch.batchId === batch.batchId;
              const failed = Boolean(candidate.failure) || candidate.status === "failed" || candidate.status === "capped";
              const listStatus = candidate.outcome !== "graded" && candidate.outcome !== "unknown" ? candidate.outcome : candidate.status;
              const StateIcon = failed ? TriangleAlert : CheckCircle2;
              return <li key={`${candidateBatch.batchId}:${candidate.runId}`}>
                <div className={`run-index-item ${active ? "is-active" : ""} ${failed ? "is-failed" : ""}`}>
                  <span className="run-index-copy">
                    <span className="run-index-title"><strong>{displayRunId(candidate.runId)}</strong><span className={`run-index-status ${failed ? "is-failed" : "is-success"}`} role="img" aria-label={listStatus.replaceAll("_", " ")}><StateIcon size={14} aria-hidden="true" /></span></span>
                    <time dateTime={candidate.events.at(-1)?.timestamp ?? candidate.importedAt}>{runClock(candidate)}</time>
                  </span>
                  <button type="button" className={`run-index-open ${detailOpen ? "is-open" : ""}`} aria-label={detailOpen ? `Close ${displayRunId(candidate.runId)} run detail` : `Open ${displayRunId(candidate.runId)} run detail`} aria-pressed={detailOpen} onClick={() => toggleRunDetail(candidateBatch.batchId, candidate.runId, listIndex)}>{detailOpen ? <ChevronLeft size={16} aria-hidden="true" /> : <ChevronRight size={16} aria-hidden="true" />}</button>
                </div>
              </li>;
            })}
          </ol>
        </section>
      </aside>

      <main className={view === "details" ? "detail-main" : "compare-main"}>
        <div className="topbar">
          <div className="topbar-context"><strong>{view === "compare" ? "Compare runs" : "Run detail"}</strong></div>
          <div className="topbar-actions">
            <input ref={inputRef} type="file" accept="application/json,.json" hidden onChange={(event) => { const file = event.target.files?.[0]; if (file) void importEvidence(file); event.target.value = ""; }} />
            <UiButton type="button" onClick={() => inputRef.current?.click()}><Import size={15} aria-hidden="true" />Import evidence</UiButton>
          </div>
        </div>

        {view === "details" ? <>
          <div className="view-stage run-detail-stage">
            <Overview run={run} />
            <div className="trace-layout">
              <ExecutionTrace run={run} selectedEventId={selectedEvent?.eventId ?? null} progress={progress} playing={playing} speed={speed} onProgress={setProgress} onPlaying={setPlaying} onSpeed={setSpeed} onSelect={(event: ArgusEvent) => { setSelectedEventId(event.eventId); setEvidenceOpen(true); }} />
              <Inspector event={selectedEvent} open={evidenceOpen} onOpenChange={setEvidenceOpen} />
            </div>
            <AuditDetails batch={batch} item={item} loadedAt={loadedAtByRunId[run.runId] ?? run.importedAt} />
          </div>
        </> : <div className="view-stage compare-stage"><Suspense fallback={<div className="compare-loading">Loading Run space…</div>}><CompareRuns reports={demoPortalReports} selectedId={selectedCompareReportId} onSelectedIdChange={setSelectedCompareReportId} /></Suspense></div>}
      </main>
    </div>
  );
}

export function App() {
  return (
    <Tooltip.Provider delay={350}>
      <Toast.Provider limit={3} timeout={6000}>
        <AppContent />
        <UiToastViewport />
      </Toast.Provider>
    </Tooltip.Provider>
  );
}
