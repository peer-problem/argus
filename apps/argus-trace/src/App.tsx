import { Button } from "@base-ui/react/button";
import { Collapsible } from "@base-ui/react/collapsible";
import { Toast } from "@base-ui/react/toast";
import { Tooltip } from "@base-ui/react/tooltip";
import { CheckCircle2, ChevronRight, GitCompareArrows, Import, Radar, TriangleAlert } from "lucide-react";
import { lazy, Suspense, useEffect, useMemo, useRef, useState } from "react";
import type { ArgusBatch, ArgusBatchItem, ArgusEvent, ArgusRun } from "../../../lab/lib/types.ts";
import { DataArrivalFlow, RunSignals, TokenFlow } from "./components/AnalysisViews.tsx";
import { ExecutionTrace } from "./components/ExecutionTrace.tsx";
import { Inspector } from "./components/Inspector.tsx";
import { UiButton, UiToastViewport } from "./components/ui/Controls.tsx";
import { demoBatches, demoRuns, makeImportedBatch } from "./data/demo.ts";
import { demoPortalReports } from "./data/portalReports.ts";
import { capShare, dependencyWaveCount, finalAnswerPreview, formatDuration, formatNumber, taskCount, visibleEvents } from "./derive.ts";

type View = "details" | "compare";

const CompareRuns = lazy(() => import("./components/CompareRuns.tsx").then((module) => ({ default: module.CompareRuns })));

function isArgusRun(value: unknown): value is ArgusRun {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Partial<ArgusRun>;
  return typeof candidate.runId === "string" && Array.isArray(candidate.events) && Boolean(candidate.totals) && Boolean(candidate.compliance);
}

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

function Overview({ run }: { run: ArgusRun }) {
  const cap = capShare(run);
  const tasks = taskCount(run);
  const waves = dependencyWaveCount(run);
  const finalAnswer = run.finalAnswer?.trim() ?? "";
  const metrics = [
    ["Bench score", run.score == null ? "—" : `${Math.round(run.score * 100)}%`, run.outcome.replaceAll("_", " ")],
    ["Tokens used", formatNumber(run.caps.usedTokens, 0), cap == null ? "cap unknown" : `${Math.round(cap * 100)}% of cap`],
    ["Cost", formatNumber(run.totals.normalizedCost, 0), "normalized units"],
    ["Latency", formatDuration(run.totals.latencyMs), `${run.events.length} events`],
    ["Tasks", `${tasks || "—"}`, waves ? `${waves} dependency ${waves === 1 ? "wave" : "waves"}` : "topology not observed"]
  ];
  return (
    <header className="run-overview">
      <div className="run-title-block">
        <div className="run-kicker"><span className={`track-mark track-${run.track}`} aria-hidden="true" />{run.track}<span aria-hidden="true">/</span>{run.dataset}{run.itemId && <><span aria-hidden="true">/</span><span>Item {run.itemId}</span></>}</div>
        <div className="run-title-line"><h1 title={run.runId}>{displayRunId(run.runId)}</h1><div className="run-statuses"><StatusMark run={run} /><PortalMark run={run} /></div></div>
        <Collapsible.Root className="final-answer-collapsible">
          <Collapsible.Trigger className="final-answer-trigger" disabled={!finalAnswer}>
            <span>Final answer</span><code>{finalAnswerPreview(run.finalAnswer)}</code><ChevronRight className="final-answer-icon" size={15} aria-hidden="true" />
          </Collapsible.Trigger>
          {finalAnswer && <Collapsible.Panel className="final-answer-panel"><pre>{run.finalAnswer}</pre></Collapsible.Panel>}
        </Collapsible.Root>
      </div>
      <dl className="overview-metrics">
        {metrics.map(([label, value, note]) => <div key={label}><dt>{label}</dt><dd>{value}</dd><small>{note}</small></div>)}
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

function AppContent() {
  const initialLoadedAt = useRef(new Date().toISOString());
  const [batches, setBatches] = useState<ArgusBatch[]>(demoBatches);
  const [loadedAtByRunId, setLoadedAtByRunId] = useState<Record<string, string>>(() => Object.fromEntries(demoRuns.map((item) => [item.runId, initialLoadedAt.current])));
  const [selectedBatchId, setSelectedBatchId] = useState(demoBatches[0]!.batchId);
  const [selectedRunId, setSelectedRunId] = useState(initialDemoRun.runId);
  const [view, setView] = useState<View>("details");
  const [progress, setProgress] = useState(1);
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState(1);
  const [selectedEventId, setSelectedEventId] = useState<string | null>(initialDemoRun.events.at(-1)!.eventId);
  const inputRef = useRef<HTMLInputElement>(null);
  const toastManager = Toast.useToastManager();
  const batch = batches.find((candidate) => candidate.batchId === selectedBatchId) ?? batches[0]!;
  const item = batch.items.find((candidate) => candidate.trace.runId === selectedRunId) ?? batch.items[0]!;
  const run = item.trace;
  const latestItems = useMemo(() => batches.flatMap((candidateBatch) => candidateBatch.items.map((candidateItem) => ({ batch: candidateBatch, item: candidateItem }))).sort((a, b) => runTimestamp(b.item.trace) - runTimestamp(a.item.trace)), [batches]);
  const revealed = useMemo(() => visibleEvents(run.events, progress), [run, progress]);
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
    const latest = visibleEvents(run.events, progress).at(-1);
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
    setView("details");
  }

  function openCompare() {
    setView("compare");
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
      setView("details");
      toastManager.add({ title: "Evidence imported", description: `${incoming.length} run${incoming.length === 1 ? "" : "s"} added.` });
    } catch (error) {
      toastManager.add({ title: "Import failed", description: (error as Error).message, type: "error" });
    }
  }

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="brand"><span className="brand-mark"><Radar size={19} aria-hidden="true" /></span><span className="brand-copy"><strong>ARGUS</strong><small>Trace</small></span></div>
        <div className="sidebar-action">
          <UiButton variant={view === "compare" ? "primary" : "quiet"} type="button" onClick={openCompare}><GitCompareArrows size={16} aria-hidden="true" />Compare runs</UiButton>
        </div>
        <section className="run-index" aria-labelledby="run-index-title">
          <div className="run-index-head"><strong id="run-index-title">Runs</strong><small>{latestItems.length}</small></div>
          <ol>
            {latestItems.map(({ batch: candidateBatch, item: candidateItem }) => {
              const candidate = candidateItem.trace;
              const active = candidate.runId === run.runId;
              const failed = Boolean(candidate.failure) || candidate.status === "failed" || candidate.status === "capped";
              const listStatus = candidate.outcome !== "graded" && candidate.outcome !== "unknown" ? candidate.outcome : candidate.status;
              return <li key={`${candidateBatch.batchId}:${candidate.runId}`}>
                <Button type="button" className={`run-index-item ${active ? "is-active" : ""} ${failed ? "is-failed" : ""}`} aria-current={active ? "page" : undefined} onClick={() => activateRun(candidateBatch.batchId, candidate.runId)}>
                  <span className={`track-mark track-${candidate.track}`} aria-hidden="true" />
                  <span className="run-index-copy"><strong>{displayRunId(candidate.runId)}</strong></span>
                  <span className="run-index-meta"><time dateTime={candidate.events.at(-1)?.timestamp ?? candidate.importedAt}>{runClock(candidate)}</time><b>{listStatus.replaceAll("_", " ")}</b></span>
                </Button>
              </li>;
            })}
          </ol>
        </section>
      </aside>

      <main>
        <div className="topbar">
          <div className="topbar-context"><strong>{view === "compare" ? "Compare runs" : run.runId}</strong></div>
          <div className="topbar-actions">
            {view === "compare" && <UiButton variant="quiet" type="button" onClick={() => setView("details")}>Back to run</UiButton>}
            <input ref={inputRef} type="file" accept="application/json,.json" hidden onChange={(event) => { const file = event.target.files?.[0]; if (file) void importEvidence(file); event.target.value = ""; }} />
            <UiButton type="button" onClick={() => inputRef.current?.click()}><Import size={15} aria-hidden="true" />Import evidence</UiButton>
          </div>
        </div>

        {view === "details" ? <>
          <div className="view-stage">
            <Overview run={run} />
            <div className="trace-layout">
              <ExecutionTrace run={run} events={revealed} selectedEventId={selectedEvent?.eventId ?? null} progress={progress} playing={playing} speed={speed} onProgress={setProgress} onPlaying={setPlaying} onSpeed={setSpeed} onSelect={(event: ArgusEvent) => setSelectedEventId(event.eventId)} />
              <Inspector event={selectedEvent} />
            </div>
            <RunSignals run={run} />
            <RunLimits batch={batch} item={item} />
            <div className="lower-analysis"><TokenFlow run={run} /><DataArrivalFlow item={item} loadedAt={loadedAtByRunId[run.runId] ?? run.importedAt} /></div>
          </div>
        </> : <div className="view-stage compare-stage"><Suspense fallback={<div className="compare-loading">Loading Run space…</div>}><CompareRuns reports={demoPortalReports} /></Suspense></div>}
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
