import type { Track, ValidationIssue, ValidationResult } from "./types.ts";

export const TASK_PLACEHOLDER = "{{TASK}}";

export const REQUIRED_OUTPUT: Record<Exclude<Track, "unknown">, string> = {
  coding: [
    "=== REQUIRED OUTPUT ===",
    "Your answer must contain a patch, written as SEARCH/REPLACE edit blocks between the two",
    "patch markers:",
    "",
    "*** PATCH START ***",
    "path/to/file.py",
    "<<<<<<< SEARCH",
    "<the exact lines currently in the file>",
    "=======",
    "<the lines that replace them>",
    ">>>>>>> REPLACE",
    "*** PATCH END ***",
    "",
    "Rules: one path line before every <<<<<<< SEARCH; repeat the three-marker block once per",
    "edit; paths are relative to the repository root; SEARCH must be whole lines copied from",
    "the file; an empty SEARCH section creates a new file.",
    "",
    "Only what lies between *** PATCH START *** and *** PATCH END *** is graded.",
    "If more than one appears, the last one is used.",
    "Anything before it is ignored, not penalised.",
    "The full format specification, with worked examples and every failure code, is published",
    "as `docs/contracts/patch-format.md`."
  ].join("\n"),
  math: [
    "=== REQUIRED OUTPUT ===",
    "End your answer with a line of exactly this form:",
    "",
    "FINAL ANSWER: \\boxed{<answer>}",
    "",
    "Put the final answer, and nothing else, inside \\boxed{}.",
    "If more than one appears, the last one is used.",
    "Anything before it is ignored, not penalised."
  ].join("\n"),
  generic: [
    "=== REQUIRED OUTPUT ===",
    "End your answer with a line of exactly this form:",
    "",
    "ANSWER: <letter>",
    "",
    "Replace <letter> with the single letter of the option you choose, and write nothing else",
    "on that line.",
    "If more than one appears, the last one is used.",
    "Anything before it is ignored, not penalised."
  ].join("\n")
};

export function normalizeNewlines(value: string): string {
  return value.replace(/\r\n?/g, "\n");
}

export function stripTrailingWhitespace(value: string): string {
  return normalizeNewlines(value)
    .split("\n")
    .map((line) => line.replace(/[\t ]+$/g, ""))
    .join("\n")
    .replace(/\n+$/g, "");
}

export function placeholderCount(prompt: string): number {
  return prompt.split(TASK_PLACEHOLDER).length - 1;
}

export function lintPrompt(prompt: string, path = "prompt"): ValidationResult {
  const issues: ValidationIssue[] = [];
  const count = placeholderCount(prompt);
  if (count !== 1) {
    issues.push({ code: "PROMPT_TASK_COUNT", message: `Expected exactly one ${TASK_PLACEHOLDER}; found ${count}.`, path, severity: "error" });
  }
  if (/\r/.test(prompt)) {
    issues.push({ code: "PROMPT_CRLF", message: "Prompt contains CR or CRLF line endings.", path, severity: "error" });
  }
  const trailingLine = normalizeNewlines(prompt).split("\n").findIndex((line) => /[\t ]+$/.test(line));
  if (trailingLine >= 0) {
    issues.push({ code: "PROMPT_TRAILING_WHITESPACE", message: `Trailing whitespace on line ${trailingLine + 1}.`, path, severity: "error" });
  }
  if (stripTrailingWhitespace(prompt).split("\n").at(-1) !== TASK_PLACEHOLDER) {
    issues.push({ code: "PROMPT_SUFFIX", message: `${TASK_PLACEHOLDER} must be the final prompt content.`, path, severity: "error" });
  }
  if (/^=== REQUIRED OUTPUT ===$|\*\*\* PATCH START \*\*\*|^FINAL ANSWER: \\boxed\{|^ANSWER: <letter>/m.test(prompt)) {
    issues.push({ code: "PROMPT_DUPLICATE_OUTPUT_CONTRACT", message: "Prompt duplicates the portal REQUIRED OUTPUT body.", path, severity: "error" });
  }
  if (/https?:\/\//i.test(prompt)) {
    issues.push({ code: "PROMPT_EXTERNAL_URL", message: "Prompt contains an external URL.", path, severity: "error" });
  }
  if (!/Use only AI:GO native coordination\./i.test(prompt)) {
    issues.push({ code: "PROMPT_NATIVE_BOUNDARY", message: "Prompt must constrain coordination to AI:GO's native protocol.", path, severity: "error" });
  }
  if (!/(?:Do not|Never) call(?: or request)? a user tool/i.test(prompt)) {
    issues.push({ code: "PROMPT_USER_TOOL_BOUNDARY", message: "Prompt must explicitly prohibit user-facing tool calls.", path, severity: "error" });
  }
  const externalAction = /\b(?:use|call|invoke|run|browse|clone|search|query|open)\b[^.!?]{0,80}\b(?:user tool|MCP|shell|filesystem|calculator|browser|repository|search|retrieval|external API|sidecar|external model|tests?)\b/i;
  for (const sentence of prompt.split(/[.!?](?:\s+|$)/)) {
    const match = externalAction.exec(sentence);
    if (match && !/\b(?:do not|never|must not|without|no)\b/i.test(sentence.slice(0, match.index))) {
      issues.push({ code: "PROMPT_EXTERNAL_ACTION", message: `Prompt contains a positive external action instruction: ${match[0]}.`, path, severity: "error" });
      break;
    }
  }
  return { ok: !issues.some((issue) => issue.severity === "error"), issues };
}

export function composeRequest(
  prompt: string,
  itemRequest: string,
  track: Exclude<Track, "unknown">,
  requiredOutput = REQUIRED_OUTPUT[track]
): string {
  const promptLint = lintPrompt(prompt);
  if (!promptLint.ok) {
    throw new Error(promptLint.issues.map((issue) => issue.message).join(" "));
  }
  const cleanPrompt = stripTrailingWhitespace(prompt);
  const cleanTask = stripTrailingWhitespace(itemRequest);
  const cleanOutput = stripTrailingWhitespace(requiredOutput);
  const substituted = cleanPrompt.split(TASK_PLACEHOLDER).join(cleanTask);
  return `${stripTrailingWhitespace(substituted)}\n\n${cleanOutput}\n`;
}
