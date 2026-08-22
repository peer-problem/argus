import { Collapsible } from "@base-ui/react/collapsible";
import { Tabs } from "@base-ui/react/tabs";
import { Toast } from "@base-ui/react/toast";
import { Tooltip } from "@base-ui/react/tooltip";
import { Activity, Binary, CheckCircle2, ChevronRight, CircleGauge, GitCompareArrows, Import, Radar, ShieldCheck, TriangleAlert } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import type { ArgusEvent, ArgusRun } from "../../../lab/lib/types.ts";
import { CapView, CompareView, ComplianceView, FailuresView, Provenance, TokenFlow } from "./components/AnalysisViews.tsx";
import { Inspector } from "./components/Inspector.tsx";
import { PeerButton, PeerSelect, PeerToastViewport } from "./components/peer/PeerControls.tsx";
import { Swimlanes } from "./components/Swimlanes.tsx";
import { TaskGraph } from "./components/TaskGraph.tsx";
import { demoRuns } from "./data/demo.ts";
import { agentNames, capShare, dependencyWaveCount, finalAnswerPreview, formatDuration, formatNumber, modelNames, taskCount, visibleEvents } from "./derive.ts";

type View = "replay" | "compare" | "caps" | "failures" | "compliance";

const navigation: Array<{ view: View; label: string; Icon: typeof Activity }> = [
  { view: "replay", label: "Run replay", Icon: Activity },
  { view: "compare", label: "Compare runs", Icon: GitCompareArrows },
  { view: "caps", label: "Cap burn-down", Icon: CircleGauge },
  { view: "failures", label: "Failure ownership", Icon: TriangleAlert },
  { view: "compliance", label: "Compliance", Icon: ShieldCheck }
];

function isArgusRun(value: unknown): value is ArgusRun {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Partial<ArgusRun>;
  return typeof candidate.runId === "string" && Array.isArray(candidate.events) && Boolean(candidate.totals) && Boolean(candidate.compliance);
}

function StatusMark({ run }: { run: ArgusRun }) {
  const contractFailed = run.status === "completed" && run.compliance.outputContract === false;
  const ungraded = run.status === "completed" && run.outcome === "unknown" && !contractFailed;
  const label = contractFailed ? "Contract failed" : ungraded ? "Completed · ungraded" : run.status.replaceAll("_", " ");
  const tone = contractFailed ? "failed" : ungraded ? "unknown" : run.status;
  const Icon = run.status === "completed" && !contractFailed ? CheckCircle2 : TriangleAlert;
  return <span className={`status-mark status-${tone}`}><Icon size={14} aria-hidden="true" />{label}</span>;
}

function displayRunId(runId: string): string {
  return runId.length > 26 ? `${runId.slice(0, 6)}…${runId.slice(-4)}` : runId;
}

function Overview({ run }: { run: ArgusRun }) {
  const cap = capShare(run);
  const tasks = taskCount(run);
  const waves = dependencyWaveCount(run);
  const finalAnswer = run.finalAnswer?.trim() ?? "";
  const modelLabel = run.modelUsage.map((usage) => usage.model.split("/").at(-1)).join(" + ");
  const detailLabel = [run.itemId, modelLabel].filter(Boolean).join(" · ") || "No item or model attribution";
  const metrics = [
    ["Score", run.score == null ? "—" : `${Math.round(run.score * 100)}%`, run.outcome.replaceAll("_", " ")],
    ["Tokens", formatNumber(run.caps.usedTokens, 0), cap == null ? "cap unknown" : `${Math.round(cap * 100)}% of cap`],
    ["Cost", formatNumber(run.totals.normalizedCost, 0), "normalized units"],
    ["Time", formatDuration(run.totals.latencyMs), `${run.events.length} events`],
    ["Graph", `${tasks || "—"} ${tasks === 1 ? "task" : "tasks"}`, waves ? `${waves} dependency ${waves === 1 ? "wave" : "waves"}` : "topology not observed"]
  ];
  return (
    <header className="run-overview">
      <div className="run-title-block">
        <div className="run-kicker"><span className={`track-mark track-${run.track}`} aria-hidden="true" />{run.track}<span aria-hidden="true">/</span>{run.dataset}</div>
        <div className="run-title-line"><h1 title={run.runId}>{displayRunId(run.runId)}</h1><StatusMark run={run} /></div>
        <p>{detailLabel}</p>
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

function AppContent() {
  const [runs, setRuns] = useState<ArgusRun[]>(demoRuns);
  const [selectedRunId, setSelectedRunId] = useState(demoRuns[0]!.runId);
  const [secondaryId, setSecondaryId] = useState(demoRuns[1]!.runId);
  const [view, setView] = useState<View>("replay");
  const [progress, setProgress] = useState(1);
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState(1);
  const [selectedEventId, setSelectedEventId] = useState<string | null>(demoRuns[0]!.events.at(-1)!.eventId);
  const [agentFilter, setAgentFilter] = useState("all");
  const [modelFilter, setModelFilter] = useState("all");
  const inputRef = useRef<HTMLInputElement>(null);
  const toastManager = Toast.useToastManager();
  const run = runs.find((item) => item.runId === selectedRunId) ?? runs[0]!;
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

  function selectRun(id: string) {
    setSelectedRunId(id);
    const next = runs.find((item) => item.runId === id);
    setProgress(1);
    setPlaying(false);
    setSelectedEventId(next?.events.at(-1)?.eventId ?? null);
    setAgentFilter("all");
    setModelFilter("all");
    if (secondaryId === id) setSecondaryId(runs.find((item) => item.runId !== id)?.runId ?? id);
  }

  async function importEvidence(file: File) {
    try {
      const parsed: unknown = JSON.parse(await file.text());
      const incoming = Array.isArray(parsed) ? parsed : [parsed];
      if (!incoming.every(isArgusRun)) throw new Error("Use normalized ARGUS run JSON. Run the Lab importer on raw exports first.");
      const first = incoming[0]!;
      setRuns((current) => [...incoming, ...current.filter((existing) => !incoming.some((candidate) => candidate.runId === existing.runId))]);
      setSelectedRunId(first.runId);
      setProgress(1);
      setPlaying(false);
      setSelectedEventId(first.events.at(-1)?.eventId ?? null);
      setAgentFilter("all");
      setModelFilter("all");
      if (secondaryId === first.runId) setSecondaryId(runs.find((item) => item.runId !== first.runId)?.runId ?? first.runId);
      toastManager.add({ title: "Run imported", description: `${first.runId} is now the active evidence source.` });
    } catch (error) {
      toastManager.add({ title: "Import failed", description: (error as Error).message, type: "error" });
    }
  }

  const runOptions = runs.map((item) => ({ value: item.runId, label: `${item.runId} · ${item.track}` }));
  const trackOptions = [...new Set(runs.map((item) => item.track))].map((track) => ({ value: track, label: track }));
  const agentOptions = [{ value: "all", label: "All agents" }, ...agentNames(run).map((agent) => ({ value: agent, label: agent }))];
  const modelOptions = [{ value: "all", label: "All models" }, ...modelNames(run).map((model) => ({ value: model, label: model.split("/").at(-1) ?? model }))];

  return (
    <Tabs.Root className="app-shell" orientation="vertical" value={view} onValueChange={(next) => setView(next as View)}>
      <aside className="sidebar">
        <div className="brand"><span className="brand-mark"><Radar size={19} aria-hidden="true" /></span><span className="brand-copy"><strong>ARGUS</strong><small>Trace</small></span></div>
        <Tabs.List className="primary-navigation" aria-label="Trace views">
          {navigation.map(({ view: target, label, Icon }) => (
            <Tabs.Tab key={target} className="primary-navigation-tab" value={target} aria-label={label}>
              <Icon size={17} aria-hidden="true" /><span>{label}</span>
            </Tabs.Tab>
          ))}
          <Tabs.Indicator className="primary-navigation-indicator" />
        </Tabs.List>
        <div className="sidebar-foot">
          <Binary size={16} aria-hidden="true" />
          <div><span>Source priority</span><strong>{run.source === "demo" ? "Demonstration" : run.source === "portal" ? "Portal truth" : run.source === "aigo" ? "AI:GO export" : "Merged evidence"}</strong></div>
          <small>v0.1</small>
        </div>
      </aside>

      <main>
        <div className="topbar">
          <PeerSelect className="run-picker" label="Loaded run" value={run.runId} options={runOptions} onValueChange={selectRun} />
          <div className="topbar-actions">
            {run.source === "demo" && <span className="demo-badge">Demo data</span>}
            <input ref={inputRef} type="file" accept="application/json,.json" hidden onChange={(event) => { const file = event.target.files?.[0]; if (file) void importEvidence(file); event.target.value = ""; }} />
            <PeerButton type="button" onClick={() => inputRef.current?.click()}><Import size={15} aria-hidden="true" />Import run</PeerButton>
          </div>
        </div>

        <Tabs.Panel className="view-stage" value="replay">
          <Overview run={run} />
          <div className="filter-strip" aria-label="Trace filters">
            <span>Focus</span>
            <PeerSelect label="Track" value={run.track} options={trackOptions} onValueChange={(track) => { const next = runs.find((item) => item.track === track); if (next) selectRun(next.runId); }} />
            <PeerSelect label="Agent" value={agentFilter} options={agentOptions} onValueChange={setAgentFilter} />
            <PeerSelect label="Model" value={modelFilter} options={modelOptions} onValueChange={setModelFilter} />
            {(agentFilter !== "all" || modelFilter !== "all") && <PeerButton variant="quiet" type="button" onClick={() => { setAgentFilter("all"); setModelFilter("all"); }}>Clear focus</PeerButton>}
          </div>
          <div className="replay-layout">
            <div className="replay-main">
              <TaskGraph run={run} events={revealed} agentFilter={agentFilter} modelFilter={modelFilter} onSelect={(event: ArgusEvent) => setSelectedEventId(event.eventId)} />
              <Swimlanes run={run} events={revealed} selectedEventId={selectedEvent?.eventId ?? null} progress={progress} playing={playing} speed={speed} agentFilter={agentFilter} modelFilter={modelFilter} onProgress={setProgress} onPlaying={setPlaying} onSpeed={setSpeed} onSelect={(event: ArgusEvent) => setSelectedEventId(event.eventId)} />
            </div>
            <Inspector event={selectedEvent} />
          </div>
          <div className="lower-analysis"><TokenFlow run={run} modelFilter={modelFilter} /><Provenance run={run} /></div>
        </Tabs.Panel>
        <Tabs.Panel className="view-stage" value="compare"><CompareView runs={runs} primary={run} secondaryId={secondaryId} onSecondary={setSecondaryId} /></Tabs.Panel>
        <Tabs.Panel className="view-stage" value="caps"><CapView runs={runs} run={run} /></Tabs.Panel>
        <Tabs.Panel className="view-stage" value="failures"><FailuresView runs={runs} /></Tabs.Panel>
        <Tabs.Panel className="view-stage" value="compliance"><ComplianceView run={run} /></Tabs.Panel>
      </main>
    </Tabs.Root>
  );
}

export function App() {
  return (
    <Tooltip.Provider delay={350}>
      <Toast.Provider limit={3} timeout={6000}>
        <AppContent />
        <PeerToastViewport />
      </Toast.Provider>
    </Tooltip.Provider>
  );
}
