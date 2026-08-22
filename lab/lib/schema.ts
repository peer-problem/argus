import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import Ajv2020 from "ajv/dist/2020.js";
import addFormats from "ajv-formats";
import type { ValidationIssue, ValidationResult } from "./types.ts";

const here = dirname(fileURLToPath(import.meta.url));
const schemaRoot = resolve(here, "../../schemas");
const eventSchema = JSON.parse(readFileSync(resolve(schemaRoot, "argus-event.schema.json"), "utf8"));
const runSchema = JSON.parse(readFileSync(resolve(schemaRoot, "argus-run.schema.json"), "utf8"));
const experimentSchema = JSON.parse(readFileSync(resolve(schemaRoot, "argus-experiment.schema.json"), "utf8"));
const candidateLadderSchema = JSON.parse(readFileSync(resolve(schemaRoot, "argus-candidate-ladder.schema.json"), "utf8"));

const ajv = new Ajv2020({ allErrors: true, strict: true });
addFormats(ajv);
ajv.addSchema(eventSchema);
ajv.addSchema(runSchema);
ajv.addSchema(experimentSchema);
ajv.addSchema(candidateLadderSchema);

export function validateSchema(kind: "event" | "run" | "experiment" | "candidate-ladder", value: unknown): ValidationResult {
  const id = `https://argus.local/schemas/argus-${kind}.schema.json`;
  const validator = ajv.getSchema(id);
  if (!validator) throw new Error(`Schema not loaded: ${id}`);
  const ok = validator(value);
  const issues: ValidationIssue[] = (validator.errors ?? []).map((error: { keyword: string; message?: string; instancePath: string }) => ({
    code: `SCHEMA_${error.keyword.toUpperCase()}`,
    message: error.message ?? "Schema validation failed.",
    path: error.instancePath || "$",
    severity: "error"
  }));
  return { ok: Boolean(ok), value, issues };
}
