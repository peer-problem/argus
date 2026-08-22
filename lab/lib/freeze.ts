import { copyFileSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { basename, resolve } from "node:path";
import { auditCandidate, lintSquadConfig, scanSecrets } from "./compliance.ts";
import { sha256File } from "./hash.ts";
import { lintAigoSource } from "./aigo.ts";

export interface FreezeInput {
  candidatePath: string;
  liveConfigPath: string;
  submissionJsonPath: string;
  promptPaths: string[];
  outputDirectory: string;
}

export function freezeCandidate(input: FreezeInput): { manifestPath: string; hashes: Record<string, string> } {
  const candidate = JSON.parse(readFileSync(input.candidatePath, "utf8"));
  const audit = auditCandidate(candidate);
  if (!audit.freezeReady) throw new Error(`Candidate is not freeze-ready:\n${audit.issues.map((issue) => `- ${issue.message}`).join("\n")}`);
  for (const path of [input.liveConfigPath, input.submissionJsonPath, ...input.promptPaths]) {
    const raw = readFileSync(path, "utf8");
    const scan = scanSecrets(raw, path);
    if (!scan.ok) throw new Error(`Secret scan failed for ${path}.`);
  }
  const liveConfig = JSON.parse(readFileSync(input.liveConfigPath, "utf8"));
  const liveLint = lintAigoSource(liveConfig);
  if (!liveLint.ok) throw new Error(`Live AI:GO config violates direct-Squad invariants:\n${liveLint.issues.map((issue) => `- ${issue.message}`).join("\n")}`);
  const submission = JSON.parse(readFileSync(input.submissionJsonPath, "utf8"));
  const configLint = lintSquadConfig(submission);
  if (!configLint.ok) throw new Error(`Submission JSON violates Squad invariants:\n${configLint.issues.map((issue) => `- ${issue.message}`).join("\n")}`);
  mkdirSync(input.outputDirectory, { recursive: true });
  const destinations = {
    candidate: resolve(input.outputDirectory, "argus-candidate.json"),
    squadConfig: resolve(input.outputDirectory, "argus-squad-config.json"),
    submissionJson: resolve(input.outputDirectory, "argus-squad-submission.json")
  };
  copyFileSync(input.candidatePath, destinations.candidate);
  copyFileSync(input.liveConfigPath, destinations.squadConfig);
  copyFileSync(input.submissionJsonPath, destinations.submissionJson);
  const hashes: Record<string, string> = {
    candidate: sha256File(destinations.candidate),
    squadConfig: sha256File(destinations.squadConfig),
    submissionJson: sha256File(destinations.submissionJson)
  };
  for (const promptPath of input.promptPaths) {
    const destination = resolve(input.outputDirectory, basename(promptPath));
    copyFileSync(promptPath, destination);
    hashes[`prompt:${basename(promptPath)}`] = sha256File(destination);
  }
  const manifestPath = resolve(input.outputDirectory, "freeze-manifest.json");
  writeFileSync(manifestPath, JSON.stringify({
    frozenAt: new Date().toISOString(),
    candidateId: candidate.candidateId,
    evidence: candidate.evidence,
    hashes
  }, null, 2) + "\n");
  return { manifestPath, hashes };
}
