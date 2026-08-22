import { AlertTriangle, Check, CircleAlert, Gauge, ShieldCheck, X } from "lucide-react";
import type { ArgusBatchItem, ArgusRun } from "../types.ts";
import { cacheShare, capShare, comparisonIsMatched, complianceScore, failureCounts, formatDuration, formatNumber } from "../derive.ts";
import { dataArrivalsFor } from "../data/demo.ts";
import { UiProgress, UiSelect } from "./ui/Controls.tsx";

export function TokenFlow({ run, modelFilter = "all" }: { run: ArgusRun; modelFilter?: string }) {
  const total = Math.max(1, run.totals.input + run.totals.output);
  const cached = Math.min(run.totals.cachedInput, run.totals.input);
  const fresh = run.totals.input - cached;
  return (
    <section className="analysis-section token-flow" aria-labelledby="token-title">
      <div className="section-heading"><div><p className="eyebrow">Consumption</p><h2 id="token-title">Token flow</h2></div><strong>{formatNumber(total, 0)} total</strong></div>
      <div className="token-bar" aria-label={`${fresh} fresh input, ${cached} cached input, ${run.totals.output} output`}>
        <span className="fresh" style={{ width: `${(fresh / total) * 100}%` }} />
        <span className="cached" style={{ width: `${(cached / total) * 100}%` }} />
        <span className="output" style={{ width: `${(run.totals.output / total) * 100}%` }} />
      </div>
      <div className="token-legend"><span><i className="fresh" />Fresh input <strong>{formatNumber(fresh, 0)}</strong></span><span><i className="cached" />Cached <strong>{formatNumber(cached, 0)}</strong></span><span><i className="output" />Output <strong>{formatNumber(run.totals.output, 0)}</strong></span></div>
      <div className="model-lines">
        {run.modelUsage.map((usage) => <div key={usage.model} className={modelFilter !== "all" && modelFilter !== usage.model ? "is-dimmed" : ""}><span>{usage.model.split("/").at(-1)}</span><span>{usage.calls} calls</span><span>{formatNumber(usage.normalizedCost, 0)} cost units</span><span>{formatDuration(usage.latencyMs)}</span></div>)}
      </div>
    </section>
  );
}

function formatRecordedAt(recordedAt: string, startedAt?: string) {
  const end = new Date(recordedAt).toISOString();
  return startedAt ? `${new Date(startedAt).toISOString()} → ${end}` : end;
}

export function DataArrivalFlow({ item, loadedAt }: { item: ArgusBatchItem; loadedAt: string }) {
  const arrivals = dataArrivalsFor(item, loadedAt);
  const run = item.trace;
  return (
    <section className="analysis-section data-arrival" aria-labelledby="data-arrival-title">
      <div className="section-heading">
        <div><p className="eyebrow">Recorded delivery</p><h2 id="data-arrival-title">Data arrival</h2></div>
        <span className="section-note">{run.source === "demo" ? "separate fixture records · not live transport" : "source records · local replay"}</span>
      </div>
      <ol>{arrivals.map((arrival, index) => (
        <li key={arrival.id}>
          <span className="arrival-index">{String(index + 1).padStart(2, "0")}</span>
          <div className="arrival-copy">
            <strong>{arrival.protocol}</strong>
            <small>{arrival.source} <span aria-hidden="true">→</span> {arrival.receiver}</small>
            <time dateTime={arrival.recordedAt}>{formatRecordedAt(arrival.recordedAt, arrival.startedAt)}</time>
            <p>{arrival.data}</p>
            {arrival.reference && <code>{arrival.reference}</code>}
          </div>
        </li>
      ))}</ol>
    </section>
  );
}

export function CompareView({ runs, primary, secondaryId, onSecondary }: { runs: ArgusRun[]; primary: ArgusRun; secondaryId: string; onSecondary: (id: string) => void }) {
  const secondary = runs.find((run) => run.runId === secondaryId) ?? runs.find((run) => run.runId !== primary.runId) ?? primary;
  const scoredRuns = runs.filter((run) => run.score != null);
  const maxCost = Math.max(...scoredRuns.map((run) => run.totals.normalizedCost), 1);
  const maxLatency = Math.max(...scoredRuns.map((run) => run.totals.latencyMs), 1);
  const matched = comparisonIsMatched(primary, secondary);
  const rows: Array<[string, string, string, "lower" | "higher"]> = [
    ["Accuracy", primary.score == null ? "—" : `${Math.round(primary.score * 100)}%`, secondary.score == null ? "—" : `${Math.round(secondary.score * 100)}%`, "higher"],
    ["Normalized cost", formatNumber(primary.totals.normalizedCost, 0), formatNumber(secondary.totals.normalizedCost, 0), "lower"],
    ["Latency", formatDuration(primary.totals.latencyMs), formatDuration(secondary.totals.latencyMs), "lower"],
    ["Cached share", `${Math.round(cacheShare(primary) * 100)}%`, `${Math.round(cacheShare(secondary) * 100)}%`, "higher"],
    ["Input tokens", formatNumber(primary.totals.input, 0), formatNumber(secondary.totals.input, 0), "lower"]
  ];
  return (
    <div className="analysis-page">
      <header className="page-title"><div><p className="eyebrow">Candidate evidence</p><h1>Compare runs</h1><p>Accuracy first; cost and wall-clock break ties.</p></div><UiSelect className="compare-picker" label="Compare with" value={secondary.runId} onValueChange={onSecondary} options={runs.filter((run) => run.runId !== primary.runId).map((run) => ({ value: run.runId, label: run.runId }))} /></header>
      <div className="compare-grid">
        <section className="pareto-panel">
          <div className="section-heading"><div><p className="eyebrow">Pareto field</p><h2>Accuracy × cost</h2></div><span className="section-note">scored runs only · circle size = latency</span></div>
          <svg className="pareto-chart" viewBox="0 0 680 330" role="img" aria-label="Accuracy and normalized cost scatter plot">
            {[0, .25, .5, .75, 1].map((value) => <g key={value}><line x1="58" x2="652" y1={282 - value * 236} y2={282 - value * 236} /><text x="42" y={286 - value * 236}>{Math.round(value * 100)}</text></g>)}
            <text className="axis-label" x="315" y="322">NORMALIZED COST →</text>
            <text className="axis-label" transform="translate(14 215) rotate(-90)">ACCURACY →</text>
            {scoredRuns.map((run) => {
              const x = 58 + (run.totals.normalizedCost / maxCost) * 570;
              const y = 282 - (run.score ?? 0) * 236;
              const radius = 7 + (run.totals.latencyMs / maxLatency) * 14;
              const selected = run.runId === primary.runId || run.runId === secondary.runId;
              return <g key={run.runId} className={`${selected ? "selected-point" : ""} ${run.source === "demo" ? "demo-point" : ""}`}><circle cx={x} cy={y} r={radius}><title>{run.runId}: score {run.score}, cost {run.totals.normalizedCost}, latency {run.totals.latencyMs}ms, source {run.source}</title></circle><text x={x} y={y - radius - 8} textAnchor="middle">{run.runId.split("-").slice(0, 2).join("-")}{run.source === "demo" ? " · demo" : ""}</text></g>;
            })}
          </svg>
        </section>
        <section className="compare-table">
          <div className="compare-head"><div><span>Baseline</span><strong>{primary.runId}</strong></div><div><span>Candidate</span><strong>{secondary.runId}</strong></div></div>
          {rows.map(([label, a, b, preference]) => {
            const numericA = label === "Accuracy" || label === "Cached share" ? Number(a.replace("%", "")) : label === "Latency" ? primary.totals.latencyMs : Number(a.replace(/,/g, ""));
            const numericB = label === "Accuracy" || label === "Cached share" ? Number(b.replace("%", "")) : label === "Latency" ? secondary.totals.latencyMs : Number(b.replace(/,/g, ""));
            const winner = !matched || Number.isNaN(numericA) || Number.isNaN(numericB) ? "tie" : numericA === numericB ? "tie" : (preference === "higher" ? numericA > numericB : numericA < numericB) ? "a" : "b";
            return <div className="compare-row" key={label}><span>{label}</span><strong className={winner === "a" ? "winner" : ""}>{a}</strong><strong className={winner === "b" ? "winner" : ""}>{b}</strong></div>;
          })}
          <div className={`compare-verdict ${matched ? "" : "is-unverified"}`}><Gauge size={18} /><p>{matched ? <><strong>{primary.score! > secondary.score! || primary.score === secondary.score && primary.totals.normalizedCost < secondary.totals.normalizedCost ? primary.runId : secondary.runId}</strong> sits on the stronger observed frontier for this matched item.</> : <>No frontier verdict. Both runs must have scores and match on track, dataset, and item.</>}</p></div>
        </section>
      </div>
    </div>
  );
}

export function CapView({ runs, run }: { runs: ArgusRun[]; run: ArgusRun }) {
  const points = run.events.map((event, index) => ({ item: index + 1, tokens: run.events.slice(0, index + 1).reduce((sum, entry) => sum + entry.tokens.input + entry.tokens.output + entry.tokens.reasoning, 0) }));
  const max = run.caps.runTokens ?? Math.max(run.caps.usedTokens, 1);
  const polyline = points.map((point, index) => `${54 + (index / Math.max(1, points.length - 1)) * 700},${286 - (point.tokens / max) * 226}`).join(" ");
  const share = capShare(run);
  return (
    <div className="analysis-page">
      <header className="page-title"><div><p className="eyebrow">Hard feasibility</p><h1>Cap burn-down</h1><p>Token caps are benchmark failure boundaries, not efficiency suggestions.</p></div>{share != null && <div className={`cap-number ${share > .85 ? "danger" : ""}`}><span>Current run</span><strong>{Math.round(share * 100)}%</strong><small>of token cap</small></div>}</header>
      <section className={`cap-chart-panel ${run.caps.runTokens == null ? "cap-unverified" : ""}`}>
        {run.caps.runTokens == null ? <div className="cap-empty"><Gauge size={25} /><div><strong>Portal token cap not observed</strong><span>{formatNumber(run.caps.usedTokens, 0)} tokens are recorded, but no percentage or safe ceiling can be inferred.</span></div></div> : <svg className="cap-chart" viewBox="0 0 800 340" role="img" aria-label="Token cap burn-down chart">
          {[0, .25, .5, .75, 1].map((value) => <g key={value}><line x1="54" x2="754" y1={286 - value * 226} y2={286 - value * 226} /><text x="42" y={290 - value * 226} textAnchor="end">{Math.round(value * 100)}%</text></g>)}
          <line className="margin-line" x1="54" x2="754" y1={286 - .85 * 226} y2={286 - .85 * 226} /><text className="margin-label" x="748" y={286 - .85 * 226 - 8} textAnchor="end">85% safe ceiling</text>
          <polyline points={polyline} />
          {points.map((point, index) => <circle key={point.item} cx={54 + (index / Math.max(1, points.length - 1)) * 700} cy={286 - (point.tokens / max) * 226} r="5"><title>{run.events[index]?.kind}: {formatNumber(point.tokens, 0)} tokens</title></circle>)}
        </svg>}
        <div className="cap-summary"><div><span>Run cap</span><strong>{run.caps.runTokens ? formatNumber(run.caps.runTokens, 0) : "Unknown"}</strong></div><div><span>Observed</span><strong>{formatNumber(run.caps.usedTokens, 0)}</strong></div><div><span>Safe ceiling</span><strong>{run.caps.runTokens ? formatNumber(run.caps.runTokens * .85, 0) : "Unknown"}</strong></div><div><span>Wall-clock</span><strong>{formatDuration(run.caps.elapsedMs)}</strong></div></div>
      </section>
      <section className="run-burn-list"><div className="section-heading"><div><p className="eyebrow">All loaded runs</p><h2>Risk scan</h2></div></div>{runs.map((item) => { const itemShare = capShare(item); const percent = itemShare == null ? null : Math.min(100, itemShare * 100); return <div key={item.runId} className={itemShare == null ? "is-unverified" : ""}><span className={`track-mark track-${item.track}`} aria-hidden="true" /><strong>{item.runId}</strong><span>{item.track}</span><UiProgress label={`${item.runId} token cap usage`} value={percent} tone={percent != null && percent > 85 ? "danger" : itemShare == null ? "muted" : "default"} /><b>{itemShare == null ? "unverified" : `${Math.round(itemShare * 100)}%`}</b></div>; })}</section>
    </div>
  );
}

export function FailuresView({ runs }: { runs: ArgusRun[] }) {
  const counts = failureCounts(runs);
  const owners = ["team", "policy", "configuration", "organizer", "unknown"];
  const max = Math.max(1, ...Object.values(counts));
  return (
    <div className="analysis-page">
      <header className="page-title"><div><p className="eyebrow">Diagnosis</p><h1>Failure ownership</h1><p>Portal enums remain primary truth; ARGUS tags add a narrower diagnostic.</p></div></header>
      <section className="ownership-chart"><div className="section-heading"><div><p className="eyebrow">Loaded evidence</p><h2>Failures by owner</h2></div></div>{owners.map((owner) => <div key={owner}><span>{owner}</span><UiProgress label={`${owner} failures`} value={counts[owner] ?? 0} max={max} /><strong>{counts[owner] ?? 0}</strong></div>)}</section>
      <section className="failure-list"><div className="failure-list-head"><span>Run</span><span>Portal outcome</span><span>Owner</span><span>Secondary diagnosis</span></div>{runs.filter((run) => run.failure).map((run) => <div key={run.runId}><strong><span className={`track-mark track-${run.track}`} aria-hidden="true" />{run.runId}</strong><span>{run.outcome.replaceAll("_", " ")}</span><span className={`owner owner-${run.failure!.owner}`}>{run.failure!.owner}</span><div><span>{run.failure!.message || "Failure metadata observed without a message."}</span><small>{run.failure!.secondaryTags.join(" · ") || "No secondary tag"}</small></div></div>)}{!runs.some((run) => run.failure) && <div className="failure-empty">No failure evidence is loaded.</div>}</section>
    </div>
  );
}

function displayKey(key: string): string {
  return key.replace(/([a-z0-9])([A-Z])/g, "$1 $2").replaceAll("_", " ").replace(/^./, (letter) => letter.toUpperCase());
}

export function ComplianceView({ run }: { run: ArgusRun }) {
  const score = complianceScore(run);
  return (
    <div className="analysis-page">
      <header className="page-title"><div><p className="eyebrow">Runtime boundary</p><h1>Compliance panel</h1><p>Observable evidence only—unknown is never promoted to passed.</p></div><div className="compliance-total"><ShieldCheck size={21} /><strong>{score.passed}/{score.total}</strong><span>checks passed</span></div></header>
      {run.source === "demo" && <div className="demo-warning"><AlertTriangle size={17} /><p><strong>Demonstration data.</strong> This UI fixture proves rendering and interaction, not a live AI:GO gate.</p></div>}
      <section className="compliance-list">{Object.entries(run.compliance).map(([key, value]) => <div key={key} className={value === true ? "pass" : value === false ? "fail" : "unknown"}><span className="check-icon">{value === true ? <Check size={16} /> : value === false ? <X size={16} /> : <CircleAlert size={16} />}</span><div><strong>{displayKey(key)}</strong><small>Reported by the imported run evidence</small></div><b>{value === true ? "Passed" : value === false ? "Failed" : "Unknown"}</b></div>)}</section>
      <section className="hash-list"><div className="section-heading"><div><p className="eyebrow">Reproducibility</p><h2>Artifact identity</h2></div></div>{Object.entries(run.hashes).map(([key, value]) => <div key={key}><span>{key}</span><code>{value ?? "not recorded"}</code></div>)}</section>
    </div>
  );
}
