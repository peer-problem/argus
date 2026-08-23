<div align="center">
  <img src="apps/argus-trace/public/argus-mark.png" width="96" alt="ARGUS logo" />
  <h1>ARGUS</h1>
  <h3>Visual observability for agentic execution</h3>
  <p><em>Compare the outcome. Trace the cause.</em></p>
  <p>
    <img src="https://img.shields.io/badge/React-19.1-61DAFB?style=flat-square&logo=react&logoColor=111827" alt="React 19.1" />
    <img src="https://img.shields.io/badge/TypeScript-5.9-3178C6?style=flat-square&logo=typescript&logoColor=white" alt="TypeScript 5.9" />
    <img src="https://img.shields.io/badge/Vite-7.1-646CFF?style=flat-square&logo=vite&logoColor=white" alt="Vite 7.1" />
    <img src="https://img.shields.io/badge/ECharts-6.1-AA344D?style=flat-square&logo=apacheecharts&logoColor=white" alt="ECharts 6.1" />
    <img src="https://img.shields.io/badge/Unovis-1.6-ABC929?style=flat-square" alt="Unovis 1.6" />
    <img src="https://img.shields.io/badge/AI%3AGO-Integrated-6641E9?style=flat-square" alt="AI:GO integration" />
  </p>
</div>

<p align="center">
  <img src="assets/readme/argus-overview.png" alt="ARGUS Compare Runs overview" />
</p>

<p align="center">
  <a href="#our-methodology">Methodology</a> ·
  <a href="#see-performance-as-a-space-not-a-leaderboard">Compare Runs</a> ·
  <a href="#read-execution-in-the-coordinate-system-it-happened-in">Run Detail</a> ·
  <a href="#the-visualization-principles">Principles</a>
</p>

---

> **ARGUS** is a visual observability system for agentic execution. It maps quality, resource use, and efficiency across runs, then reconstructs any selected outcome as a causal, evidence-backed trace.

An agent run is a temporal system of planning, delegation, model calls, parallel work, verification, and recovery. Yet it is usually remembered as a score, a token count, or a pass/fail state. Those summaries are easy to scan but difficult to learn from; raw logs preserve the evidence but hide the overall behavior.

ARGUS is designed between those extremes. It keeps both levels of truth visible: **compare outcomes across runs, then trace any result back through its execution.**

## Our methodology

### Overview → deviation → evidence

ARGUS follows the natural sequence of an investigation:

1. **Observe the population.** Understand the range of outcomes and the trade-offs across runs.
2. **Locate the deviation.** Find the run, model, track, or moment that breaks the expected pattern.
3. **Explain the cause.** Reconstruct the execution and inspect the evidence behind the anomaly.

The two pages are not separate dashboards, but two resolutions of the same question. **Compare Runs** provides breadth; **Run Detail** provides causality. Selection connects them so the user can move from pattern to proof without rebuilding context.

## See performance as a space, not a leaderboard

![ARGUS Compare Runs view](assets/readme/compare-runs.png)

The **Compare Runs** view places every run inside a three-dimensional decision space: benchmark score, total tokens, and token efficiency. These axes were chosen because they describe the central tension in agent evaluation: the quality produced, the resources consumed, and the value obtained from those resources.

A run is not presented as simply “better” or “worse.” Position shows its balance of quality and resource use; distance and clustering reveal relationships before the user reads a row of data. The selected run becomes a stable visual anchor while the surrounding views explain its composition.

The surrounding charts preserve the context that a single ranking removes:

- **Track accuracy** reveals where quality was gained or lost.
- **Input and output tokens** expose each model’s share of the budget.
- **Score, efficiency, and model calls over time** make regressions and outliers visible.

Aligned time axes and repeated colors let the user compare change without repeatedly decoding the interface. Bars show discrete composition and magnitude, the line shows efficiency as a continuous signal, and the 3D field is reserved for the relationship among three competing measures.

This makes comparison actionable. Did a score improve because one track improved? Did efficiency rise because fewer calls were made? The overview identifies the run worth investigating; the linked detail explains what made it different.

## Read execution in the coordinate system it happened in

![ARGUS Run Detail view](assets/readme/run-detail.png)

The **Run Detail** view reconstructs an execution on a shared wall-clock. Each row represents an actor and call; position shows when it occurred, length shows duration, color identifies the model, and connectors preserve task dependencies. Token use stays attached to the call that produced it.

Time is the common coordinate because it reveals what tables cannot: sequence, concurrency, idle gaps, slow calls, and the handoff where behavior changed. A single scan distinguishes parallel work from events that merely appear adjacent in a log.

Replay is not decorative animation. It restores the order in which information became available, turning a completed trace into a causal narrative. Event selection leads to the underlying record, while audit details expose limits, compliance, and provenance. The same view supports a fast behavioral read and a slower forensic one.

## The visualization principles

**Structure before detail.** The first view answers “where should I look?” before asking the user to inspect individual events.

**Trade-offs over vanity metrics.** Quality, tokens, latency, and model calls remain visible together so improvement in one dimension cannot conceal regression in another.

**One visual variable, one job.** Position communicates time or performance space, length communicates magnitude or duration, color identifies categories, and emphasis communicates selection.

**Evidence over reconstruction theater.** Actors, models, tasks, checks, and provenance are derived from the imported run rather than imposed by a fixed roster. When a relationship is inferred rather than observed, ARGUS says so.

**Progressive disclosure over indiscriminate density.** The first read stays visual. Events, limits, compliance, and provenance appear when the investigation requires them.

**Consistency across scale.** The selected run remains the subject of its supporting charts and detailed trace, carrying context forward through every transition.

---

ARGUS does not make complex execution look simple. It makes that complexity legible—first as a pattern, then as a sequence, and finally as evidence.

It is built around a simple belief: **an agent run should be inspectable as a system, not remembered as a score.**
