import { Collapsible } from "@base-ui/react/collapsible";
import { Toast } from "@base-ui/react/toast";
import { Tooltip } from "@base-ui/react/tooltip";
import { CheckCircle2, ChevronLeft, ChevronRight, FlaskConical, GitCompareArrows, Import, TriangleAlert } from "lucide-react";
import { lazy, Suspense, useEffect, useMemo, useRef, useState } from "react";
import type { ArgusBatch, ArgusBatchItem, ArgusEvent, ArgusRun } from "./types.ts";
import { DataArrivalFlow, RunSignals, TokenFlow } from "./components/AnalysisViews.tsx";
import { isArgusRun } from "./contracts.ts";
import { ExecutionTrace } from "./components/ExecutionTrace.tsx";
import { Inspector } from "./components/Inspector.tsx";
import { RunResultDetails } from "./components/RunResultDetails.tsx";
import { UiButton, UiIconButton, UiToastViewport } from "./components/ui/Controls.tsx";
import { capturedPortalBatch, capturedPortalRuns } from "./data/capturedPortalRuns.ts";
import { demoBatches, demoRuns, makeImportedBatch } from "./data/demo.ts";
import { capturedPortalReports, demoLinkedPortalReports } from "./data/portalReports.ts";
import { capShare, formatDuration, formatNumber, taskCount, traceCallSpans, visibleTraceCallEvents } from "./derive.ts";

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

const comparisonReports = capturedPortalReports;
const demoReportIdByRunId = new Map([...demoRuns]
  .sort((a, b) => runTimestamp(b) - runTimestamp(a))
  .map((run, index) => [run.runId, demoLinkedPortalReports[index]?.reportId]));
const initialPortalRun = capturedPortalRuns[0]!;

function linkedComparisonReport(run: ArgusRun) {
  const direct = run.portalRunId == null ? undefined : comparisonReports.find((report) => report.reportId === run.portalRunId);
  if (direct) return direct;
  const demoReportId = run.source === "demo" ? demoReportIdByRunId.get(run.runId) : undefined;
  return demoReportId == null ? undefined : comparisonReports.find((report) => report.reportId === demoReportId);
}

function conciseRunWarning(run: ArgusRun): string | null {
  if (run.failure?.message) return run.failure.message;
  if (run.outcome === "extraction_failed") return "Required final-answer format was not met.";
  if (run.status === "capped") return "Run stopped at its configured limit.";
  if (run.status === "failed" || run.failure) return "Run failed before a final answer was accepted.";
  return null;
}

function Overview({ run }: { run: ArgusRun }) {
  const facts = [
    ["Score", run.score == null ? "Not observed" : `${Math.round(run.score * 100)}%`],
    ["Tokens", formatNumber(run.caps.usedTokens, 0)],
    ["Duration", formatDuration(run.totals.latencyMs)],
    ["Cost", formatNumber(run.totals.normalizedCost, 0)]
  ];
  const warning = conciseRunWarning(run);
  return (
    <header className="run-overview">
      <div className="run-title-block">
        <div className="run-title-line"><div><small className="run-execution-id">Execution ID · <code title={run.runId}>{run.runId}</code></small><h1>{run.detail?.planTitle ?? displayRunId(run.runId)}</h1></div><div className="run-statuses"><StatusMark run={run} /><PortalMark run={run} /></div></div>
        {warning && <p className="run-failure-summary" role="alert"><TriangleAlert size={14} aria-hidden="true" /><span>{warning}</span></p>}
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
    ["Batch runs", `${batch.items.length}`, "same evidence set"]
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

function EmptyEvidenceState({ mockDataExcluded, onImport }: { mockDataExcluded: boolean; onImport: () => void }) {
  return (
    <section className="trace-empty" aria-labelledby="empty-evidence-title">
      <span className="trace-empty-icon"><Import size={22} aria-hidden="true" /></span>
      <div>
        <p className="eyebrow">Run detail</p>
        <h1 id="empty-evidence-title">No evidence loaded</h1>
        <p>{mockDataExcluded ? "Mock data is excluded. Include it again or import a compatible ARGUS run JSON file." : "Import a compatible ARGUS run JSON file to inspect its execution evidence."}</p>
        <UiButton type="button" onClick={onImport}><Import size={15} aria-hidden="true" />Import evidence</UiButton>
      </div>
    </section>
  );
}

function AppContent() {
  const initialLoadedAt = useRef(new Date().toISOString());
  const [importedBatches, setImportedBatches] = useState<ArgusBatch[]>([]);
  const [includeMockData, setIncludeMockData] = useState(true);
  const batches = useMemo(() => includeMockData ? [...importedBatches, capturedPortalBatch, ...demoBatches] : [...importedBatches, capturedPortalBatch], [importedBatches, includeMockData]);
  const portalReports = comparisonReports;
  const [loadedAtByRunId, setLoadedAtByRunId] = useState<Record<string, string>>(() => Object.fromEntries([...capturedPortalRuns, ...demoRuns].map((item) => [item.runId, initialLoadedAt.current])));
  const [selectedBatchId, setSelectedBatchId] = useState(capturedPortalBatch.batchId);
  const [selectedRunId, setSelectedRunId] = useState(initialPortalRun.runId);
  const [selectedCompareReportId, setSelectedCompareReportId] = useState(initialPortalRun.portalRunId ?? "");
  const [view, setView] = useState<View>("compare");
  const [progress, setProgress] = useState(1);
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState(1);
  const [selectedEventId, setSelectedEventId] = useState<string | null>(traceCallSpans(initialPortalRun).at(-1)?.event.eventId ?? null);
  const [evidenceOpen, setEvidenceOpen] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const toastManager = Toast.useToastManager();
  const batch = batches.find((candidate) => candidate.batchId === selectedBatchId) ?? batches[0] ?? null;
  const item = batch?.items.find((candidate) => candidate.trace.runId === selectedRunId) ?? batch?.items[0] ?? null;
  const run = item?.trace ?? initialPortalRun;
  const latestItems = useMemo(() => batches.flatMap((candidateBatch) => candidateBatch.items.map((candidateItem) => ({ batch: candidateBatch, item: candidateItem }))).sort((a, b) => runTimestamp(b.item.trace) - runTimestamp(a.item.trace)), [batches]);
  const activeListIndex = latestItems.findIndex(({ item: candidateItem }) => linkedComparisonReport(candidateItem.trace)?.reportId === selectedCompareReportId);
  const revealed = useMemo(() => visibleTraceCallEvents(run, progress), [run, progress]);
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
    const latest = visibleTraceCallEvents(run, progress).at(-1);
    if (playing && latest) setSelectedEventId(latest.eventId);
  }, [playing, progress, run]);

  useEffect(() => {
    if (!item) {
      setPlaying(false);
      setEvidenceOpen(false);
    }
  }, [item]);

  function activateRun(batchId: string, id: string) {
    const nextBatch = batches.find((candidate) => candidate.batchId === batchId);
    const nextRuns = nextBatch?.items.map((candidate) => candidate.trace) ?? [];
    const next = nextRuns.find((candidate) => candidate.runId === id);
    if (!nextBatch || !next) return;
    setSelectedBatchId(batchId);
    setSelectedRunId(id);
    setProgress(1);
    setPlaying(false);
    setSelectedEventId(traceCallSpans(next).at(-1)?.event.eventId ?? null);
    setEvidenceOpen(false);
    setView("details");
  }

  function openCompare() {
    setView("compare");
  }

  function toggleRunDetail(batchId: string, id: string) {
    if (view === "details" && batchId === selectedBatchId && id === selectedRunId) {
      openCompare();
      return;
    }
    const linkedRun = batches.find((candidate) => candidate.batchId === batchId)?.items.find((candidate) => candidate.trace.runId === id)?.trace;
    const linkedReport = linkedRun == null ? undefined : linkedComparisonReport(linkedRun);
    if (linkedReport) setSelectedCompareReportId(linkedReport.reportId);
    activateRun(batchId, id);
  }

  function selectRunForComparison(candidate: ArgusRun) {
    const linkedReport = linkedComparisonReport(candidate);
    if (!linkedReport) return;
    setSelectedCompareReportId(linkedReport.reportId);
    setPlaying(false);
    setEvidenceOpen(false);
    setView("compare");
  }

  function toggleMockData() {
    setPlaying(false);
    setEvidenceOpen(false);
    setIncludeMockData((current) => !current);
  }

  async function importEvidence(file: File) {
    try {
      const parsed: unknown = JSON.parse(await file.text());
      const incoming = Array.isArray(parsed) ? parsed : [parsed];
      if (incoming.length === 0 || !incoming.every(isArgusRun)) throw new Error("Use compatible ARGUS run JSON. Adapt raw source evidence before loading it into Trace.");
      const first = incoming[0]!;
      const loadedAt = new Date().toISOString();
      const importedBatch = makeImportedBatch(incoming, loadedAt);
      setImportedBatches((current) => [importedBatch, ...current.filter((existing) => existing.batchId !== importedBatch.batchId)]);
      setLoadedAtByRunId((current) => ({ ...current, ...Object.fromEntries(incoming.map((item) => [item.runId, loadedAt])) }));
      setSelectedBatchId(importedBatch.batchId);
      setSelectedRunId(first.runId);
      setProgress(1);
      setPlaying(false);
      setSelectedEventId(traceCallSpans(first).at(-1)?.event.eventId ?? null);
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
        <div className="brand"><span className="brand-mark"><img src="/argus-mark.png" alt="" aria-hidden="true" /></span><span className="brand-copy"><strong>ARGUS</strong></span></div>
        <div className="sidebar-action">
          <UiButton variant={view === "compare" ? "primary" : "quiet"} type="button" onClick={openCompare}><GitCompareArrows size={16} aria-hidden="true" />Compare runs</UiButton>
        </div>
        <section className="run-index" aria-labelledby="run-index-title">
          <div className="run-index-head"><strong id="run-index-title">Runs</strong><small>{latestItems.length}</small></div>
          <ol>
            {latestItems.length === 0 && <li className="run-index-empty">No imported runs</li>}
            {latestItems.map(({ batch: candidateBatch, item: candidateItem }, listIndex) => {
              const candidate = candidateItem.trace;
              const active = listIndex === activeListIndex;
              const detailOpen = view === "details" && candidate.runId === run.runId && candidateBatch.batchId === batch?.batchId;
              const failed = Boolean(candidate.failure) || candidate.status === "failed" || candidate.status === "capped";
              const listStatus = candidate.outcome !== "graded" && candidate.outcome !== "unknown" ? candidate.outcome : candidate.status;
              const StateIcon = failed ? TriangleAlert : CheckCircle2;
              return <li key={`${candidateBatch.batchId}:${candidate.runId}`}>
                <div className={`run-index-item ${active ? "is-active" : ""} ${failed ? "is-failed" : ""}`}>
                  <button type="button" className="run-index-copy" aria-label={`Select ${displayRunId(candidate.runId)} for comparison`} aria-pressed={active} onClick={() => selectRunForComparison(candidate)}>
                    <span className="run-index-title"><strong>{displayRunId(candidate.runId)}</strong><span className={`run-index-status ${failed ? "is-failed" : "is-success"}`} role="img" aria-label={listStatus.replaceAll("_", " ")}><StateIcon size={14} aria-hidden="true" /></span></span>
                    <time dateTime={candidate.events.at(-1)?.timestamp ?? candidate.importedAt}>{runClock(candidate)}</time>
                  </button>
                  <button type="button" className={`run-index-open ${detailOpen ? "is-open" : ""}`} aria-label={detailOpen ? `Close ${displayRunId(candidate.runId)} run detail` : `Open ${displayRunId(candidate.runId)} run detail`} aria-pressed={detailOpen} onClick={() => toggleRunDetail(candidateBatch.batchId, candidate.runId)}>{detailOpen ? <ChevronLeft size={16} aria-hidden="true" /> : <ChevronRight size={16} aria-hidden="true" />}</button>
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
            <UiIconButton type="button" label={includeMockData ? "Exclude mock data" : "Include mock data"} className="mock-data-toggle" aria-pressed={includeMockData} data-state={includeMockData ? "included" : "excluded"} onClick={toggleMockData}><FlaskConical size={16} aria-hidden="true" /></UiIconButton>
            <UiButton type="button" onClick={() => inputRef.current?.click()}><Import size={15} aria-hidden="true" />Import evidence</UiButton>
          </div>
        </div>

        {view === "details" ? (batch && item ? <>
          <div className="view-stage run-detail-stage">
            <Overview run={run} />
            <div className="trace-layout">
              <ExecutionTrace run={run} selectedEventId={selectedEvent?.eventId ?? null} progress={progress} playing={playing} speed={speed} onProgress={setProgress} onPlaying={setPlaying} onSpeed={setSpeed} onSelect={(event: ArgusEvent) => { setSelectedEventId(event.eventId); setEvidenceOpen(true); }} />
              <Inspector event={selectedEvent} open={evidenceOpen} onOpenChange={setEvidenceOpen} />
            </div>
            <AuditDetails batch={batch} item={item} loadedAt={loadedAtByRunId[run.runId] ?? run.importedAt} />
            <RunResultDetails run={run} />
          </div>
        </> : <div className="view-stage run-detail-stage"><EmptyEvidenceState mockDataExcluded={!includeMockData} onImport={() => inputRef.current?.click()} /></div>) : <div className="view-stage compare-stage"><Suspense fallback={<div className="compare-loading">Loading Run space…</div>}><CompareRuns reports={portalReports} selectedId={selectedCompareReportId} onSelectedIdChange={setSelectedCompareReportId} /></Suspense></div>}
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
