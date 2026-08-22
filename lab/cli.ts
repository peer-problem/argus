#!/usr/bin/env node
import { existsSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { basename, join, resolve } from "node:path";
import { auditCandidate, loadAndLintConfig, loadAndLintConfigValue, scanSecrets } from "./lib/compliance.ts";
import { composeRequest, lintPrompt } from "./lib/compose.ts";
import { calculateCodingCoverage, type CodingRequestManifest } from "./lib/coverage.ts";
import { checksumManifest, sha256File, verifyHashManifest } from "./lib/hash.ts";
import { mergeRuns, normalizeAigoExport, normalizePortalExport } from "./lib/importers.ts";
import { EventLedger } from "./lib/ledger.ts";
import { lintAggregationPreservation, lintOutput } from "./lib/output.ts";
import { validateSchema } from "./lib/schema.ts";
import { freezeCandidate } from "./lib/freeze.ts";
import { lintAigoSource, mapAigoSquadToDelivery, snapshotAigoSquad } from "./lib/aigo.ts";
import { calibrationReports, evaluatePromotion, ExperimentLedger } from "./lib/experiments.ts";
import { lintVirtualKernelTrackPrompt } from "./lib/virtual-kernel.ts";
import { calculateCodingContextReport } from "./lib/context.ts";
import { loadAndLintCandidateLadder } from "./lib/candidates.ts";
import { assessSWEFidelity } from "./lib/fidelity.ts";
import { assessHandoff } from "./lib/handoff.ts";
import type { ArgusEvent, ArgusExperiment, ArgusRun, Track, ValidationIssue } from "./lib/types.ts";

const [, , command, ...args] = process.argv;

function usage(): never {
  console.error(`ARGUS Lab

Usage:
  argus compose <prompt> <request> <coding|math|generic> [required-output-file]
  argus coverage coding <prompt> <request-manifest> [maximum-bytes]
  argus context-report coding <prompt> <request-manifest> [output-reservation-tokens]
  argus lint-prompts <prompt-directory>
  argus lint-output <coding|math|generic> <output> [request]
  argus lint-aggregation <coding|math|generic> <solver-output> <aggregated-output> [request]
  argus lint-swe-fidelity <original-request> <planner-task> <solver-input>
  argus lint-config <candidate-json>
  argus lint-ladder <candidate-ladder-json>
  argus snapshot-aigo <live-config-json> <budget-json> <output-json> [candidate-id]
  argus map-submission <live-config-json> <output-json> [delivery-id]
  argus secret-scan <path...>
  argus import <portal|aigo> <input-json> <output-json>
  argus reconcile <portal-json> <aigo-json> <output-json>
  argus ledger-append <ledger-jsonl> <event-or-events-json>
  argus experiment-append <ledger-jsonl> <record-or-records-json>
  argus calibration-report <records-json-or-ledger-jsonl>
  argus promotion-check <records-json-or-ledger-jsonl> <baseline-id> <candidate-id> [maximum-stratum-regression]
  argus schema <event|run|experiment|candidate-ladder> <input-json>
  argus hash <file...>
  argus manifest <directory>
  argus verify-manifest <manifest-json>
  argus handoff-check <candidate-json>
  argus audit <candidate-json>
  argus freeze <candidate> <live-config> <submission-json> <output-dir> <prompt...>
`);
  process.exit(2);
}

function printIssues(issues: ValidationIssue[]): void {
  for (const issue of issues) console.error(`${issue.severity.toUpperCase()} ${issue.code}${issue.path ? ` ${issue.path}` : ""}: ${issue.message}`);
}

function failOnIssues(ok: boolean, issues: ValidationIssue[]): void {
  printIssues(issues);
  if (!ok) process.exitCode = 1;
}

function readJson(path: string): unknown {
  return JSON.parse(readFileSync(path, "utf8"));
}

function readExperiments(path: string): ArgusExperiment[] {
  const rawText = readFileSync(path, "utf8");
  const scan = scanSecrets(rawText, path);
  if (!scan.ok) throw new Error(`Credential-shaped content found in ${path}: ${scan.issues.map((issue) => issue.message).join(", ")}`);
  let raw: unknown;
  try {
    raw = JSON.parse(rawText);
  } catch {
    raw = rawText.split("\n").filter((line) => line.trim()).map((line) => JSON.parse(line));
  }
  const records = (Array.isArray(raw) ? raw : [raw]) as ArgusExperiment[];
  for (const [index, record] of records.entries()) {
    const validation = validateSchema("experiment", record);
    if (!validation.ok) throw new Error(`Invalid experiment ${path}#${index}: ${validation.issues.map((issue) => `${issue.path} ${issue.message}`).join(", ")}`);
  }
  return records;
}

function filesUnder(path: string): string[] {
  if (!existsSync(path)) return [];
  if (statSync(path).isFile()) return [path];
  return readdirSync(path, { withFileTypes: true }).flatMap((entry) => filesUnder(join(path, entry.name)));
}

if (!command) usage();

switch (command) {
  case "compose": {
    const [promptPath, requestPath, rawTrack, outputPath] = args;
    if (!promptPath || !requestPath || !rawTrack || !["coding", "math", "generic"].includes(rawTrack)) usage();
    const requiredOutput = outputPath ? readFileSync(outputPath, "utf8") : undefined;
    process.stdout.write(composeRequest(readFileSync(promptPath, "utf8"), readFileSync(requestPath, "utf8"), rawTrack as Exclude<Track, "unknown">, requiredOutput));
    break;
  }
  case "coverage": {
    const [rawTrack, promptPath, manifestPath, rawMaximum] = args;
    if (rawTrack !== "coding" || !promptPath || !manifestPath) usage();
    const maximum = rawMaximum == null ? 65_536 : Number(rawMaximum);
    if (!Number.isInteger(maximum) || maximum <= 0) usage();
    const report = calculateCodingCoverage(
      readFileSync(promptPath, "utf8"),
      readJson(manifestPath) as CodingRequestManifest,
      maximum
    );
    console.log(JSON.stringify(report, null, 2));
    break;
  }
  case "context-report": {
    const [rawTrack, promptPath, manifestPath, rawOutputReservation] = args;
    if (rawTrack !== "coding" || !promptPath || !manifestPath) usage();
    const outputReservation = rawOutputReservation == null ? 12_288 : Number(rawOutputReservation);
    if (!Number.isInteger(outputReservation) || outputReservation < 0) usage();
    const report = calculateCodingContextReport(
      readFileSync(promptPath, "utf8"),
      readJson(manifestPath) as CodingRequestManifest,
      outputReservation
    );
    console.log(JSON.stringify(report, null, 2));
    break;
  }
  case "lint-prompts": {
    const directory = args[0];
    if (!directory) usage();
    let ok = true;
    for (const name of ["coding.md", "math.md", "generic.md"]) {
      const path = resolve(directory, name);
      if (!existsSync(path)) {
        ok = false;
        printIssues([{ code: "PROMPT_MISSING", message: `Missing ${name}.`, path, severity: "error" }]);
        continue;
      }
      const result = lintPrompt(readFileSync(path, "utf8"), path);
      const track = name.replace(".md", "") as Exclude<Track, "unknown">;
      const virtualKernel = lintVirtualKernelTrackPrompt(track, readFileSync(path, "utf8"), path);
      ok &&= result.ok && virtualKernel.ok;
      printIssues([...result.issues, ...virtualKernel.issues]);
    }
    if (!ok) process.exitCode = 1;
    else console.log("All three ARGUS prompts satisfy the local contract.");
    break;
  }
  case "lint-output": {
    const [rawTrack, outputPath, requestPath] = args;
    if (!rawTrack || !outputPath || !["coding", "math", "generic"].includes(rawTrack)) usage();
    const result = lintOutput(rawTrack as Exclude<Track, "unknown">, readFileSync(outputPath, "utf8"), requestPath ? readFileSync(requestPath, "utf8") : undefined);
    failOnIssues(result.ok, result.issues);
    if (result.value) console.log(JSON.stringify(result.value, null, 2));
    break;
  }
  case "lint-aggregation": {
    const [rawTrack, solverPath, aggregatedPath, requestPath] = args;
    if (!rawTrack || !solverPath || !aggregatedPath || !["coding", "math", "generic"].includes(rawTrack)) usage();
    const result = lintAggregationPreservation(
      rawTrack as Exclude<Track, "unknown">,
      readFileSync(solverPath, "utf8"),
      readFileSync(aggregatedPath, "utf8"),
      requestPath ? readFileSync(requestPath, "utf8") : undefined
    );
    failOnIssues(result.ok, result.issues);
    if (result.value) console.log(JSON.stringify(result.value, null, 2));
    break;
  }
  case "lint-swe-fidelity": {
    const [originalPath, plannerTaskPath, solverInputPath] = args;
    if (!originalPath || !plannerTaskPath || !solverInputPath) usage();
    const result = assessSWEFidelity(
      readFileSync(originalPath, "utf8"),
      readFileSync(plannerTaskPath, "utf8"),
      readFileSync(solverInputPath, "utf8")
    );
    failOnIssues(result.ok, result.issues);
    if (result.value) console.log(JSON.stringify(result.value, null, 2));
    break;
  }
  case "lint-config": {
    const path = args[0];
    if (!path) usage();
    const result = loadAndLintConfig(path);
    failOnIssues(result.ok, result.issues);
    if (result.ok) console.log("Squad candidate satisfies the local compliance invariants.");
    break;
  }
  case "lint-ladder": {
    const path = args[0];
    if (!path) usage();
    const result = loadAndLintCandidateLadder(path);
    failOnIssues(result.ok, result.issues);
    if (result.ok) console.log("ARGUS candidate ladder is plan-only, complete, and evidence-gated.");
    break;
  }
  case "snapshot-aigo": {
    const [configPath, budgetPath, outputPath, candidateId] = args;
    if (!configPath || !budgetPath || !outputPath) usage();
    const config = readJson(configPath);
    const lint = lintAigoSource(config);
    if (!lint.ok) {
      failOnIssues(false, lint.issues);
      break;
    }
    const snapshot = snapshotAigoSquad(config, readJson(budgetPath), candidateId);
    writeFileSync(outputPath, JSON.stringify(snapshot, null, 2) + "\n");
    console.log(`Wrote sanitized direct-Squad snapshot to ${outputPath}.`);
    break;
  }
  case "map-submission": {
    const [configPath, outputPath, deliveryId] = args;
    if (!configPath || !outputPath) usage();
    const config = readJson(configPath);
    const lint = lintAigoSource(config);
    if (!lint.ok) {
      failOnIssues(false, lint.issues);
      break;
    }
    const delivery = mapAigoSquadToDelivery(config, deliveryId);
    const deliveryLint = loadAndLintConfigValue(delivery);
    if (!deliveryLint.ok) {
      failOnIssues(false, deliveryLint.issues);
      break;
    }
    writeFileSync(outputPath, JSON.stringify(delivery, null, 2) + "\n");
    console.log(`Wrote direct-Squad delivery mapping to ${outputPath}.`);
    break;
  }
  case "secret-scan": {
    if (args.length === 0) usage();
    let ok = true;
    for (const root of args) {
      for (const path of filesUnder(root)) {
        if (statSync(path).size > 10_000_000) continue;
        const result = scanSecrets(readFileSync(path, "utf8"), path);
        ok &&= result.ok;
        printIssues(result.issues);
      }
    }
    if (!ok) process.exitCode = 1;
    else console.log("No credential-shaped content found.");
    break;
  }
  case "import": {
    const [kind, inputPath, outputPath] = args;
    if (!kind || !inputPath || !outputPath || !["portal", "aigo"].includes(kind)) usage();
    const rawText = readFileSync(inputPath, "utf8");
    const scan = scanSecrets(rawText, inputPath);
    if (!scan.ok) {
      failOnIssues(false, scan.issues);
      break;
    }
    let raw: unknown;
    try {
      raw = JSON.parse(rawText);
    } catch {
      raw = { events: rawText.split("\n").filter(Boolean).map((line) => JSON.parse(line)) };
    }
    const normalized = Array.isArray(raw)
      ? raw.map((entry, index) => kind === "portal" ? normalizePortalExport(entry, `${inputPath}#${index}`) : normalizeAigoExport(entry, `${inputPath}#${index}`))
      : kind === "portal" ? normalizePortalExport(raw, inputPath) : normalizeAigoExport(raw, inputPath);
    const validations = (Array.isArray(normalized) ? normalized : [normalized]).map((run) => validateSchema("run", run));
    const issues = validations.flatMap((validation) => validation.issues);
    if (validations.some((validation) => !validation.ok)) {
      failOnIssues(false, issues);
      break;
    }
    writeFileSync(outputPath, JSON.stringify(normalized, null, 2) + "\n");
    console.log(`Normalized ${kind} evidence to ${outputPath}.`);
    break;
  }
  case "reconcile": {
    const [portalPath, aigoPath, outputPath] = args;
    if (!portalPath || !aigoPath || !outputPath) usage();
    const portalText = readFileSync(portalPath, "utf8");
    const aigoText = readFileSync(aigoPath, "utf8");
    const secretResult = scanSecrets(`${portalText}\n${aigoText}`, `${portalPath},${aigoPath}`);
    if (!secretResult.ok) {
      failOnIssues(false, secretResult.issues);
      break;
    }
    const portalRaw = JSON.parse(portalText);
    const aigoRaw = JSON.parse(aigoText);
    const portalValidation = validateSchema("run", portalRaw);
    const aigoValidation = validateSchema("run", aigoRaw);
    const portal = portalValidation.ok ? portalRaw as ArgusRun : normalizePortalExport(portalRaw, portalPath);
    const aigo = aigoValidation.ok ? aigoRaw as ArgusRun : normalizeAigoExport(aigoRaw, aigoPath);
    const merged = mergeRuns(portal, aigo);
    const mergedValidation = validateSchema("run", merged);
    if (!mergedValidation.ok) {
      failOnIssues(false, mergedValidation.issues);
      break;
    }
    writeFileSync(outputPath, JSON.stringify(merged, null, 2) + "\n");
    console.log(`Reconciled portal truth and AI:GO evidence to ${outputPath}.`);
    break;
  }
  case "ledger-append": {
    const [ledgerPath, eventPath] = args;
    if (!ledgerPath || !eventPath) usage();
    const value = readJson(eventPath) as ArgusEvent | ArgusEvent[];
    new EventLedger(ledgerPath).append(value);
    console.log(`Appended ${Array.isArray(value) ? value.length : 1} event(s) to ${ledgerPath}.`);
    break;
  }
  case "experiment-append": {
    const [ledgerPath, recordPath] = args;
    if (!ledgerPath || !recordPath) usage();
    const records = readExperiments(recordPath);
    new ExperimentLedger(ledgerPath).append(records);
    console.log(`Appended ${records.length} experiment record(s) to ${ledgerPath}.`);
    break;
  }
  case "calibration-report": {
    const [recordPath] = args;
    if (!recordPath) usage();
    console.log(JSON.stringify(calibrationReports(readExperiments(recordPath)), null, 2));
    break;
  }
  case "promotion-check": {
    const [recordPath, baselineId, candidateId, rawMaximumRegression] = args;
    if (!recordPath || !baselineId || !candidateId) usage();
    const maximumRegression = rawMaximumRegression == null ? 0 : Number(rawMaximumRegression);
    if (!Number.isFinite(maximumRegression) || maximumRegression < 0) usage();
    const report = evaluatePromotion(readExperiments(recordPath), baselineId, candidateId, maximumRegression);
    console.log(JSON.stringify(report, null, 2));
    if (!report.promotable) process.exitCode = 1;
    break;
  }
  case "schema": {
    const [kind, path] = args;
    if (!kind || !path || !["event", "run", "experiment", "candidate-ladder"].includes(kind)) usage();
    const result = validateSchema(kind as "event" | "run" | "experiment" | "candidate-ladder", readJson(path));
    failOnIssues(result.ok, result.issues);
    if (result.ok) console.log(`${basename(path)} satisfies the ${kind} schema.`);
    break;
  }
  case "hash": {
    if (args.length === 0) usage();
    for (const path of args) console.log(`${sha256File(path)}  ${path}`);
    break;
  }
  case "manifest": {
    const root = args[0];
    if (!root) usage();
    console.log(JSON.stringify(checksumManifest(root), null, 2));
    break;
  }
  case "verify-manifest": {
    const path = args[0];
    if (!path) usage();
    const result = verifyHashManifest(readJson(path));
    failOnIssues(result.ok, result.issues);
    if (result.ok) console.log(`Verified ${result.value?.length ?? 0} hash-bound artifact(s) in ${path}.`);
    break;
  }
  case "handoff-check": {
    const path = args[0];
    if (!path) usage();
    const report = assessHandoff(readJson(path));
    printIssues(report.structuralIssues);
    console.log(JSON.stringify(report, null, 2));
    if (!report.codebaseReady) process.exitCode = 1;
    break;
  }
  case "audit": {
    const path = args[0];
    if (!path) usage();
    const report = auditCandidate(readJson(path));
    printIssues(report.issues);
    console.log(JSON.stringify({ candidateValid: report.candidateValid, gates: `${report.gatesPassed}/${report.gatesRequired}`, freezeReady: report.freezeReady }, null, 2));
    if (!report.freezeReady) process.exitCode = 1;
    break;
  }
  case "freeze": {
    const [candidatePath, liveConfigPath, submissionJsonPath, outputDirectory, ...promptPaths] = args;
    if (!candidatePath || !liveConfigPath || !submissionJsonPath || !outputDirectory || promptPaths.length !== 3) usage();
    const result = freezeCandidate({ candidatePath, liveConfigPath, submissionJsonPath, outputDirectory, promptPaths });
    console.log(JSON.stringify(result, null, 2));
    break;
  }
  default:
    usage();
}
