import { AlertTriangle, Check, CircleAlert, Gauge, ShieldCheck, X } from "lucide-react";
import type { ArgusRun } from "../../../../lab/lib/types.ts";
import { cacheShare, capShare, comparisonIsMatched, complianceScore, failureCounts, formatDuration, formatNumber } from "../derive.ts";
import { PeerProgress, PeerSelect } from "./peer/PeerControls.tsx";

const virtualKernelStages = [
  ["Normalize", "Objective, constraints, evidence, contract"],
  ["Solve", "One primary candidate from supplied context"],
  ["Assert", "Track invariants checked against the input"],
  ["Repair", "At most one revision after a failed assertion"],
  ["Emit", "Only the contract-compliant artifact"]
] as const;

const contextEnvelopes = [
  ["Qwen3-32B", "Thin Planner", "40K", "Fast control route"],
  ["GPT-OSS-120B", "Universal Solver", "128K", "Context-safe v1 route"],
  ["K-EXAONE 236B", "Calibration only", "48K", "Not on baseline path"]
] as const;

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

export function Provenance({ run }: { run: ArgusRun }) {
  const taskResult = [...run.events].reverse().find((event) => event.kind === "task.completed" || event.kind === "task.failed");
  const finalState = run.compliance.outputContract === true
    ? "contract-valid artifact"
    : run.compliance.outputContract === false
      ? "observed output · contract invalid"
      : run.finalAnswer
        ? "observed output · not graded"
        : "not observed";
  const candidateState = taskResult?.candidateStatus === "selected"
    ? "selected"
    : taskResult
      ? taskResult.state === "failed" || taskResult.state === "capped" ? "task failed" : "observed task result"
      : "not observed";
  const aggregationState = run.compliance.outputContract === true
    ? "verbatim gate passed"
    : run.compliance.outputContract === false
      ? "contract failed"
      : "not evidenced";
  const steps = [
    ["Request", run.itemId ?? "unknown item"],
    ["Task", taskResult ? `${taskResult.taskTitle ?? taskResult.taskId ?? "solve"} · wave ${String((taskResult.wave ?? 0) + 1).padStart(2, "0")}` : "not observed"],
    ["Candidate", candidateState],
    ["Aggregation", aggregationState],
    ["Final", finalState]
  ];
  return (
    <section className="analysis-section provenance" aria-labelledby="provenance-title">
      <div className="section-heading"><div><p className="eyebrow">Lineage</p><h2 id="provenance-title">Answer provenance</h2></div></div>
      <ol>{steps.map(([label, value], index) => <li key={label} className={run.status !== "completed" && index > 2 ? "muted" : ""}><span>{String(index + 1).padStart(2, "0")}</span><div><strong>{label}</strong><small>{value}</small></div></li>)}</ol>
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
      <header className="page-title"><div><p className="eyebrow">Candidate evidence</p><h1>Compare runs</h1><p>Accuracy first; cost and wall-clock break ties.</p></div><PeerSelect className="compare-picker" label="Compare with" value={secondary.runId} onValueChange={onSecondary} options={runs.filter((run) => run.runId !== primary.runId).map((run) => ({ value: run.runId, label: run.runId }))} /></header>
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
      <section className="run-burn-list"><div className="section-heading"><div><p className="eyebrow">All loaded runs</p><h2>Risk scan</h2></div></div>{runs.map((item) => { const itemShare = capShare(item); const percent = itemShare == null ? null : Math.min(100, itemShare * 100); return <div key={item.runId} className={itemShare == null ? "is-unverified" : ""}><span className={`track-mark track-${item.track}`} aria-hidden="true" /><strong>{item.runId}</strong><span>{item.track}</span><PeerProgress label={`${item.runId} token cap usage`} value={percent} tone={percent != null && percent > 85 ? "danger" : itemShare == null ? "muted" : "default"} /><b>{itemShare == null ? "unverified" : `${Math.round(itemShare * 100)}%`}</b></div>; })}</section>
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
      <section className="ownership-chart"><div className="section-heading"><div><p className="eyebrow">Loaded evidence</p><h2>Failures by owner</h2></div></div>{owners.map((owner) => <div key={owner}><span>{owner}</span><PeerProgress label={`${owner} failures`} value={counts[owner] ?? 0} max={max} /><strong>{counts[owner] ?? 0}</strong></div>)}</section>
      <section className="failure-list"><div className="failure-list-head"><span>Run</span><span>Portal outcome</span><span>Owner</span><span>Secondary diagnosis</span></div>{runs.filter((run) => run.failure).map((run) => <div key={run.runId}><strong><span className={`track-mark track-${run.track}`} aria-hidden="true" />{run.runId}</strong><span>{run.outcome.replaceAll("_", " ")}</span><span className={`owner owner-${run.failure!.owner}`}>{run.failure!.owner}</span><div><span>{run.failure!.message || "Failure metadata observed without a message."}</span><small>{run.failure!.secondaryTags.join(" · ") || "No secondary tag"}</small></div></div>)}{!runs.some((run) => run.failure) && <div className="failure-empty">No failure evidence is loaded.</div>}</section>
    </div>
  );
}

const complianceLabels: Record<keyof ArgusRun["compliance"], [string, string]> = {
  userToolsZero: ["User tools", "No built-in, custom, or MCP tools attached"],
  plannerNativeProtocol: ["Native protocol", "Planner coordination remained inside AI:GO"],
  memoryOff: ["Memory", "No previous conversation context injected"],
  hashesPresent: ["Artifact hashes", "Dataset, Squad, submission, and prompt identified"],
  outputContract: ["Output contract", "Final artifact passed track extraction"],
  fallbackFree: ["Fallback", "No planner failure or roster fan-out signature"]
};

export function ComplianceView({ run }: { run: ArgusRun }) {
  const score = complianceScore(run);
  return (
    <div className="analysis-page">
      <header className="page-title"><div><p className="eyebrow">Runtime boundary</p><h1>Compliance panel</h1><p>Observable evidence only—unknown is never promoted to passed.</p></div><div className="compliance-total"><ShieldCheck size={21} /><strong>{score.passed}/{score.total}</strong><span>checks passed</span></div></header>
      {run.source === "demo" && <div className="demo-warning"><AlertTriangle size={17} /><p><strong>Demonstration data.</strong> This UI fixture proves rendering and interaction, not a live AI:GO gate.</p></div>}
      <section className="kernel-contract" aria-labelledby="kernel-contract-title">
        <div className="section-heading"><div><p className="eyebrow">Configured v1 contract</p><h2 id="kernel-contract-title">ARGUS Virtual Kernel</h2></div><span className="section-note">protocol contract · not a hidden-reasoning trace</span></div>
        <div className="kernel-topology" aria-label="Virtual Kernel agent topology">
          <div><span>Control plane</span><strong>Thin Planner</strong><small>one native task · verbatim gate</small></div>
          <b aria-hidden="true">→</b>
          <div><span>Execution subject</span><strong>Universal Solver</strong><small>one internal verification loop</small></div>
        </div>
        <ol className="answer-extraction" aria-label="Native judged answer selection order">
          <li><span>01</span><div><strong>Aggregated result</strong><small>judge checks the native aggregate first</small></div></li>
          <li><span>02</span><div><strong>Last-wave task outputs</strong><small>read backwards as the native fallback</small></div></li>
          <li><span>03</span><div><strong>Status summary refused</strong><small>execution-complete text is never accepted as the answer</small></div></li>
        </ol>
        <ol className="kernel-stages">{virtualKernelStages.map(([label, note], index) => <li key={label}><span>{String(index + 1).padStart(2, "0")}</span><div><strong>{label}</strong><small>{note}</small></div></li>)}</ol>
        <p className="kernel-boundary-note"><CircleAlert size={16} /><span>The interface shows the configured method and observable contract evidence. It never claims access to private chain-of-thought or fabricated per-stage runtime events.</span></p>
      </section>
      <section className="context-envelope" aria-labelledby="context-envelope-title">
        <div className="section-heading"><div><p className="eyebrow">Context routing</p><h2 id="context-envelope-title">Model envelopes</h2></div><span className="section-note">input + output limit</span></div>
        <div className="context-table-wrap"><table><thead><tr><th>Model</th><th>v1 role</th><th>Context</th><th>Decision</th></tr></thead><tbody>{contextEnvelopes.map(([model, role, context, decision]) => <tr key={model}><th scope="row">{model}</th><td>{role}</td><td><code>{context}</code></td><td>{decision}</td></tr>)}</tbody></table></div>
        <p className="transport-boundary"><strong>65,536-byte direct guard</strong><span>acts before model inference on the installed surface; an in-Squad pager cannot repair a request rejected before the Planner receives it.</span></p>
        <p className="transport-boundary"><strong>Event runtime cap</strong><span>is authoritative. Portal Check confirmed agent max-token and iteration settings do not reach evaluation; the 12,288 output reserve is local preflight only.</span></p>
        <p className="pager-readiness"><strong>Context Pager</strong><span><b>Experimental only.</b> The Qwen Planner must first receive the complete request inside its 40K envelope, and native lossless sequential delivery remains unverified.</span></p>
      </section>
      <section className="compliance-list">{(Object.entries(run.compliance) as Array<[keyof ArgusRun["compliance"], boolean | null]>).map(([key, value]) => { const [label, note] = complianceLabels[key]; return <div key={key} className={value === true ? "pass" : value === false ? "fail" : "unknown"}><span className="check-icon">{value === true ? <Check size={16} /> : value === false ? <X size={16} /> : <CircleAlert size={16} />}</span><div><strong>{label}</strong><small>{note}</small></div><b>{value === true ? "Passed" : value === false ? "Failed" : "Unknown"}</b></div>; })}</section>
      <section className="hash-list"><div className="section-heading"><div><p className="eyebrow">Reproducibility</p><h2>Artifact identity</h2></div></div>{Object.entries(run.hashes).map(([key, value]) => <div key={key}><span>{key}</span><code>{value ?? "not recorded"}</code></div>)}</section>
    </div>
  );
}
