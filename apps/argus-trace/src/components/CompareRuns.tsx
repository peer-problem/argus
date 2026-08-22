import { Button } from "@base-ui/react/button";
import { Tooltip } from "@base-ui/react/tooltip";
import { VisAxis, VisDonut, VisSingleContainer, VisStackedBar, VisXYContainer } from "@unovis/react";
import { TooltipComponent } from "echarts/components";
import { init, use, type EChartsType } from "echarts/core";
import { CanvasRenderer } from "echarts/renderers";
import { Scatter3DChart } from "echarts-gl/charts";
import { Grid3DComponent } from "echarts-gl/components";
import { Box, CircleGauge, Info, MousePointer2, Rotate3D } from "lucide-react";
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import type { PortalBatchRunReport, PortalTrackResult, Track } from "../../../../lab/lib/types.ts";
import { formatDuration, formatNumber, notGradedItems, portalTokenEfficiency, weightedPortalScore } from "../derive.ts";

use([CanvasRenderer, TooltipComponent, Scatter3DChart as never, Grid3DComponent as never]);

interface ModelPoint {
  index: number;
  model: string;
  input: number;
  output: number;
}

interface TrackPoint {
  index: number;
  track: Exclude<Track, "unknown">;
  accuracy: number;
}

interface TokenSlice {
  id: string;
  label: string;
  value: number;
  color: string;
}

interface ScatterDatum {
  name: string;
  reportId: string;
  value: [number, number, number];
  totalTokens: number;
  score: number;
  trackSummary: string;
}

const trackColors: Record<Exclude<Track, "unknown">, string> = {
  coding: "#2d72d2",
  math: "#7c4dff",
  generic: "#d9822b"
};

const tokenColors = ["#2d72d2", "#9fb5d1"];

function shortModel(model: string): string {
  const name = model.split("/").at(-1) ?? model;
  return name.length > 18 ? `${name.slice(0, 16)}…` : name;
}

function percent(value: number): string {
  return `${(value * 100).toFixed(1)}%`;
}

function postedClock(value: string): string {
  return new Intl.DateTimeFormat("en", { month: "short", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false, timeZone: "UTC" }).format(new Date(value));
}

function requestTotal(report: PortalBatchRunReport): number {
  return report.modelUsage.reduce((total, model) => total + model.requests, 0);
}

function MetricHelp({ label, children }: { label: string; children: ReactNode }) {
  return (
    <Tooltip.Root>
      <Tooltip.Trigger className="metric-help" aria-label={label}><Info size={13} aria-hidden="true" /></Tooltip.Trigger>
      <Tooltip.Portal>
        <Tooltip.Positioner sideOffset={8}>
          <Tooltip.Popup className="ui-tooltip-popup metric-help-popup"><Tooltip.Arrow className="ui-tooltip-arrow" />{children}</Tooltip.Popup>
        </Tooltip.Positioner>
      </Tooltip.Portal>
    </Tooltip.Root>
  );
}

function makeScatterData(reports: PortalBatchRunReport[]): ScatterDatum[] {
  return reports.map((report) => ({
    name: report.runName,
    reportId: report.reportId,
    value: [report.executionTimeMs / 60_000, report.score * 100, portalTokenEfficiency(report)],
    totalTokens: report.tokens.total,
    score: report.score,
    trackSummary: report.trackResults.map((track) => `${track.track} ${percent(track.accuracy)}`).join(" · ")
  }));
}

function pointSize(totalTokens: number, reports: PortalBatchRunReport[], selected = false): number {
  const tokenValues = reports.map((report) => report.tokens.total);
  const minimum = Math.min(...tokenValues);
  const maximum = Math.max(...tokenValues);
  const share = maximum === minimum ? 0.5 : (totalTokens - minimum) / (maximum - minimum);
  return 17 + Math.sqrt(share) * 19 + (selected ? 7 : 0);
}

function RunSpace({ reports, selectedId, onSelect }: { reports: PortalBatchRunReport[]; selectedId: string; onSelect: (reportId: string) => void }) {
  const chartElement = useRef<HTMLDivElement>(null);
  const selected = reports.find((report) => report.reportId === selectedId) ?? reports[0];

  useEffect(() => {
    const element = chartElement.current;
    if (!element || !selected) return;
    const chart = init(element, undefined, { renderer: "canvas" });
    const allData = makeScatterData(reports);
    const regular = allData.filter((datum) => datum.reportId !== selected.reportId);
    const active = allData.filter((datum) => datum.reportId === selected.reportId);
    const axisLabel = { color: "#526170", fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace", fontSize: 10 };
    const axisCommon = {
      type: "value",
      axisLine: { lineStyle: { color: "#798694", width: 1 } },
      axisLabel,
      nameTextStyle: { color: "#1c2127", fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace", fontSize: 11 },
      splitLine: { lineStyle: { color: "#dce2e8", opacity: 0.85 } },
      splitArea: { show: true, areaStyle: { color: ["rgba(247,249,251,.68)", "rgba(236,241,246,.45)"] } }
    };
    const option = {
      backgroundColor: "transparent",
      animationDuration: 650,
      animationDurationUpdate: 480,
      tooltip: {
        show: true,
        trigger: "item",
        backgroundColor: "rgba(17, 20, 24, .94)",
        borderWidth: 0,
        padding: 12,
        textStyle: { color: "#fff", fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace", fontSize: 11 },
        formatter: (params: { data?: ScatterDatum }) => {
          const datum = params.data;
          if (!datum) return "";
          return `<strong style="font-size:12px">${datum.name}</strong><br/>Time&nbsp;&nbsp;${datum.value[0].toFixed(1)} min<br/>Score&nbsp; ${datum.value[1].toFixed(1)}%<br/>Yield&nbsp;&nbsp;${datum.value[2].toFixed(1)} graded / 1M tokens<br/>Tokens&nbsp;${datum.totalTokens.toLocaleString()}<br/><span style="color:#b9c7d6">${datum.trackSummary}</span>`;
        }
      },
      grid3D: {
        boxWidth: 118,
        boxHeight: 72,
        boxDepth: 92,
        environment: "#f8fafc",
        axisPointer: { show: true, lineStyle: { color: "#2d72d2", width: 1 } },
        light: { main: { intensity: 1.25, shadow: true, alpha: 38, beta: 28 }, ambient: { intensity: 0.62 } },
        viewControl: { alpha: 18, beta: 34, distance: 175, minDistance: 100, maxDistance: 260, damping: 0.88, autoRotate: false, panSensitivity: 0 },
        postEffect: { enable: true, SSAO: { enable: true, radius: 3, intensity: 1.1 }, FXAA: { enable: true } },
        temporalSuperSampling: { enable: true }
      },
      xAxis3D: { ...axisCommon, name: "EXECUTION · MIN", min: 0, nameGap: 22, axisLabel: { ...axisLabel, formatter: (value: number) => `${Math.round(value)}` } },
      yAxis3D: { ...axisCommon, name: "WEIGHTED SCORE · %", min: 0, max: 70, nameGap: 22, axisLabel: { ...axisLabel, formatter: (value: number) => `${Math.round(value)}%` } },
      zAxis3D: { ...axisCommon, name: "GRADED / 1M TOKENS", min: 0, nameGap: 22, axisLabel: { ...axisLabel, formatter: (value: number) => `${Math.round(value)}` } },
      series: [
        {
          name: "Runs",
          type: "scatter3D",
          coordinateSystem: "cartesian3D",
          data: regular,
          symbol: "circle",
          symbolSize: (_value: number[], params: { data: ScatterDatum }) => pointSize(params.data.totalTokens, reports),
          itemStyle: { color: "#2d72d2", opacity: 0.88, borderColor: "#ffffff", borderWidth: 1 },
          label: { show: true, formatter: "{b}", distance: 4, color: "#354250", fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace", fontSize: 9, backgroundColor: "rgba(255,255,255,.78)", padding: [3, 5] },
          emphasis: { itemStyle: { color: "#7c4dff", opacity: 1 } }
        },
        {
          name: "Selected",
          type: "scatter3D",
          coordinateSystem: "cartesian3D",
          data: active,
          symbol: "circle",
          symbolSize: (_value: number[], params: { data: ScatterDatum }) => pointSize(params.data.totalTokens, reports, true),
          itemStyle: { color: "#d9822b", opacity: 1, borderColor: "#111418", borderWidth: 2 },
          label: { show: true, formatter: "{b}", distance: 6, color: "#111418", fontWeight: "bold", fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace", fontSize: 10, backgroundColor: "rgba(255,255,255,.94)", borderColor: "#d9822b", borderWidth: 1, padding: [4, 6] }
        }
      ]
    };
    chart.setOption(option as Parameters<EChartsType["setOption"]>[0]);
    chart.on("click", (params) => {
      const datum = params.data as unknown as ScatterDatum | undefined;
      if (datum?.reportId) onSelect(datum.reportId);
    });
    const resize = new ResizeObserver(() => chart.resize());
    resize.observe(element);
    return () => {
      resize.disconnect();
      chart.dispose();
    };
  }, [onSelect, reports, selected]);

  return (
    <section className="run-space" aria-labelledby="run-space-title">
      <div className="run-space-heading">
        <div><p className="eyebrow">Portal batch runs · {reports.length}</p><h2 id="run-space-title">Performance space</h2></div>
        <div className="run-space-help"><Rotate3D size={15} aria-hidden="true" /><span>Drag to orbit · Scroll to zoom · Click a Run</span></div>
      </div>
      <div className="run-space-viewport">
        <div ref={chartElement} className="run-space-canvas" role="img" aria-label="Interactive ECharts GL scatter plot comparing every Portal batch run by execution time, weighted score, and graded items per million tokens" />
        <div className="run-space-brand"><strong>ECharts GL</strong><span>Point size = total tokens</span></div>
      </div>
      <div className="run-space-ledger" aria-label="All Portal batch runs in the 3D graph">
        {reports.map((report) => {
          const active = report.reportId === selectedId;
          return (
            <Button key={report.reportId} type="button" className={`run-space-item ${active ? "is-selected" : ""}`} aria-pressed={active} onClick={() => onSelect(report.reportId)}>
              <span className="run-space-item-id"><i />{report.runName}</span>
              <span>{formatDuration(report.executionTimeMs)}</span>
              <span>{percent(report.score)}</span>
              <strong>{formatNumber(report.tokens.total, 1)}</strong>
            </Button>
          );
        })}
      </div>
    </section>
  );
}

function ModelTokenChart({ report }: { report: PortalBatchRunReport }) {
  const data = useMemo<ModelPoint[]>(() => report.modelUsage.map((usage, index) => ({ index: index + 1, model: shortModel(usage.model), input: usage.inputTokens, output: usage.outputTokens })), [report]);
  const modelAt = (value: number | Date) => data[Math.max(0, Math.round(Number(value)) - 1)]?.model ?? "";
  return (
    <article className="run-stat-chart">
      <div className="run-stat-chart-head"><div><span>MODEL FOOTPRINT</span><h3>Input + output</h3></div><strong>{data.length} models</strong></div>
      <div className="unovis-chart" key={report.reportId}>
        <VisXYContainer<ModelPoint> data={data} height={220} margin={{ top: 12, right: 12, bottom: 48, left: 54 }} xDomain={[0.5, Math.max(1.5, data.length + 0.5)]} yDomain={[0, undefined]}>
          <VisStackedBar<ModelPoint> x={(point) => point.index} y={[(point) => point.input, (point) => point.output]} color={tokenColors} barPadding={0.36} roundedCorners={2} duration={650} />
          <VisAxis<ModelPoint> type="x" tickValues={data.map((point) => point.index)} tickFormat={modelAt} tickTextFontSize="9px" tickTextWidth={108} gridLine={false} />
          <VisAxis<ModelPoint> type="y" label="TOKENS" numTicks={4} tickFormat={(value) => formatNumber(Number(value), 1)} />
        </VisXYContainer>
      </div>
      <div className="chart-inline-legend"><span><i style={{ background: tokenColors[0] }} />Input</span><span><i style={{ background: tokenColors[1] }} />Output</span></div>
    </article>
  );
}

function TrackAccuracyChart({ report }: { report: PortalBatchRunReport }) {
  const data = useMemo<TrackPoint[]>(() => report.trackResults.map((result, index) => ({ index: index + 1, track: result.track, accuracy: result.accuracy * 100 })), [report]);
  const trackAt = (value: number | Date) => data[Math.max(0, Math.round(Number(value)) - 1)]?.track ?? "";
  return (
    <article className="run-stat-chart">
      <div className="run-stat-chart-head"><div><span>BENCHMARK</span><h3>Per-track accuracy</h3></div><strong>{percent(report.score)} weighted</strong></div>
      <div className="unovis-chart" key={report.reportId}>
        <VisXYContainer<TrackPoint> data={data} height={220} margin={{ top: 12, right: 12, bottom: 42, left: 48 }} xDomain={[0.5, 3.5]} yDomain={[0, 100]}>
          <VisStackedBar<TrackPoint> x={(point) => point.index} y={[(point) => point.accuracy]} color={data.map((point) => trackColors[point.track])} barPadding={0.34} roundedCorners={2} duration={650} />
          <VisAxis<TrackPoint> type="x" tickValues={data.map((point) => point.index)} tickFormat={trackAt} gridLine={false} />
          <VisAxis<TrackPoint> type="y" label="ACCURACY" numTicks={5} tickFormat={(value) => `${Number(value)}%`} />
        </VisXYContainer>
      </div>
    </article>
  );
}

function TokenSplitChart({ report }: { report: PortalBatchRunReport }) {
  const data: TokenSlice[] = [
    { id: "input", label: "Input", value: report.tokens.input, color: tokenColors[0]! },
    { id: "output", label: "Output", value: report.tokens.output, color: tokenColors[1]! }
  ];
  return (
    <article className="run-stat-chart">
      <div className="run-stat-chart-head"><div><span>TOKEN SPLIT</span><h3>Input vs output</h3></div><strong>{formatNumber(report.tokens.total, 1)}</strong></div>
      <div className="token-mix-layout" key={report.reportId}>
        <div className="unovis-donut"><VisSingleContainer<TokenSlice[]> data={data} height={184}><VisDonut<TokenSlice> value={(slice) => slice.value} color={(slice) => slice.color} arcWidth={24} padAngle={0.025} cornerRadius={3} centralLabel={percent(report.tokens.output / report.tokens.total)} centralSubLabel="output share" duration={650} /></VisSingleContainer></div>
        <dl className="token-mix-legend">{data.map((slice) => <div key={slice.id}><dt><i style={{ background: slice.color }} />{slice.label}</dt><dd>{formatNumber(slice.value, 0)}</dd></div>)}</dl>
      </div>
    </article>
  );
}

function TrackResultCard({ result }: { result: PortalTrackResult }) {
  const notGraded = Math.max(0, result.items - result.graded);
  return (
    <article className={`track-result-card track-result-${result.track}`}>
      <div className="track-result-head"><span>{result.track}</span><strong>{percent(result.accuracy)}</strong></div>
      <div className="track-result-bar" aria-hidden="true"><i style={{ transform: `scaleX(${result.accuracy})`, backgroundColor: trackColors[result.track] }} /></div>
      <dl>
        <div><dt>Graded</dt><dd>{result.graded}</dd></div>
        <div><dt>Items</dt><dd>{result.items}</dd></div>
        <div><dt>Not graded</dt><dd>{notGraded}</dd></div>
        <div><dt>Excluded</dt><dd>{result.excluded}</dd></div>
        <div><dt>Weight</dt><dd>{Math.round(result.weight * 100)}%</dd></div>
        <div><dt>Contribution</dt><dd>{percent(result.accuracy * result.weight)}</dd></div>
      </dl>
    </article>
  );
}

function SelectedRunStats({ report }: { report: PortalBatchRunReport }) {
  const calculated = weightedPortalScore(report);
  const missing = notGradedItems(report);
  return (
    <section className="selected-run portal-report" aria-labelledby="selected-run-title" key={report.reportId}>
      <header className="selected-run-head">
        <div><p className="eyebrow">Selected Portal run · {report.team}</p><h2 id="selected-run-title">{report.runName}</h2><p>{report.status} · posted {postedClock(report.postedAt)} UTC · {report.evidence.protocol} received {postedClock(report.evidence.receivedAt)} UTC</p></div>
        <span className={`status-mark status-${report.status}`}>{report.status}</span>
      </header>

      <dl className="portal-primary-metrics">
        <div className="metric-total-tokens"><dt>Total tokens</dt><dd>{report.tokens.total.toLocaleString()}</dd><small>{report.tokens.input.toLocaleString()} input + {report.tokens.output.toLocaleString()} output</small></div>
        <div><dt>Weighted score <MetricHelp label="How the score is weighted">Coding has 2 parts of the score; math and generic have 1 part each. The normalized weights are 50%, 25%, and 25%.</MetricHelp></dt><dd>{percent(report.score)}</dd><small>tracks calculate to {percent(calculated)}</small></div>
        <div><dt>Execution time</dt><dd>{formatDuration(report.executionTimeMs)}</dd><small>{report.caps.wallClockSeconds == null ? "no wall-clock cap" : `${formatDuration(report.caps.wallClockSeconds * 1_000)} cap`}</small></div>
        <div><dt>Score coverage</dt><dd>{report.scoredItems} / {report.totalItems}</dd><small>Portal headline fields</small></div>
        <div><dt>Requests</dt><dd>{requestTotal(report).toLocaleString()}</dd><small>across {report.modelUsage.length} models</small></div>
      </dl>

      <section className="portal-track-results" aria-labelledby="portal-track-title">
        <div className="portal-section-head">
          <div><p className="eyebrow">Most important benchmark detail</p><h3 id="portal-track-title">Per-track accuracy</h3></div>
          <div className="score-formula"><span>Coding × 2</span><span>Math × 1</span><span>Generic × 1</span><MetricHelp label="Items and Graded definition">Items is the total question count. Graded excludes cases where the Agent Squad returned no answer or a patch could not be inspected, such as an invalid filename.</MetricHelp></div>
        </div>
        <div className="track-result-grid">{report.trackResults.map((result) => <TrackResultCard key={result.track} result={result} />)}</div>
        <p className="portal-field-note"><Info size={14} aria-hidden="true" />Portal exposes headline score coverage and per-track Graded as separate fields. ARGUS displays both source values without overwriting either one. Across the track rows, {missing} item{missing === 1 ? " is" : "s are"} not graded.</p>
      </section>

      <div className="run-stat-grid portal-chart-grid"><TrackAccuracyChart report={report} /><ModelTokenChart report={report} /><TokenSplitChart report={report} /></div>

      <section className="portal-model-usage" aria-labelledby="portal-model-title">
        <div className="portal-section-head"><div><p className="eyebrow">Queryable detail</p><h3 id="portal-model-title">Per-model token usage</h3></div><strong>{report.modelUsage.length} models · {requestTotal(report).toLocaleString()} requests</strong></div>
        <div className="portal-table-wrap">
          <table>
            <thead><tr><th>Model</th><th>Input</th><th>Output</th><th>Requests</th><th>Total</th></tr></thead>
            <tbody>{report.modelUsage.map((usage) => <tr key={usage.model}><th>{usage.model}</th><td>{usage.inputTokens.toLocaleString()}</td><td>{usage.outputTokens.toLocaleString()}</td><td className="secondary-value">{usage.requests.toLocaleString()}</td><td><strong>{usage.totalTokens.toLocaleString()}</strong></td></tr>)}</tbody>
            <tfoot><tr><th>Total</th><td>{report.tokens.input.toLocaleString()}</td><td>{report.tokens.output.toLocaleString()}</td><td className="secondary-value">{requestTotal(report).toLocaleString()}</td><td><strong>{report.tokens.total.toLocaleString()}</strong></td></tr></tfoot>
          </table>
        </div>
      </section>
    </section>
  );
}

export function CompareRuns({ reports }: { reports: PortalBatchRunReport[] }) {
  const [selectedId, setSelectedId] = useState(() => reports[0]?.reportId ?? "");
  const selected = reports.find((report) => report.reportId === selectedId) ?? reports[0];

  if (!selected) return <div className="compare-empty"><Box size={20} /><p>No Portal Run report is loaded.</p></div>;

  return (
    <div className="analysis-page compare-runs-page">
      <header className="page-title compare-page-title">
        <div><p className="eyebrow">Run intelligence</p><h1>Compare runs</h1><p>Every Portal batch Run in one navigable performance space.</p></div>
        <div className="compare-axis-key" aria-label="3D graph axes">
          <span><i className="axis-x">X</i><b>Time</b><small>execution minutes</small></span>
          <span><i className="axis-y">Y</i><b>Accuracy</b><small>weighted score</small></span>
          <span><i className="axis-z">Z</i><b>Efficiency</b><small>graded / 1M tokens</small></span>
        </div>
      </header>
      <div className="compare-method-note"><CircleGauge size={16} aria-hidden="true" /><p>Efficiency is an absolute yield: the sum of track-level Graded divided by total tokens, shown per one million tokens. Point size independently shows total token usage.</p><MousePointer2 size={15} aria-hidden="true" /></div>
      <RunSpace reports={reports} selectedId={selected.reportId} onSelect={setSelectedId} />
      <SelectedRunStats report={selected} />
    </div>
  );
}
