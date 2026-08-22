import { appendFileSync, existsSync, readFileSync } from "node:fs";
import type { ArgusEvent } from "./types.ts";
import { validateSchema } from "./schema.ts";

export class EventLedger {
  constructor(readonly path: string) {}

  read(): ArgusEvent[] {
    if (!existsSync(this.path)) return [];
    const lines = readFileSync(this.path, "utf8").split("\n").filter(Boolean);
    return lines.map((line, index) => {
      const event = JSON.parse(line) as ArgusEvent;
      const validation = validateSchema("event", event);
      if (!validation.ok) throw new Error(`Invalid event on ledger line ${index + 1}: ${validation.issues.map((issue) => issue.message).join(", ")}`);
      return event;
    });
  }

  append(events: ArgusEvent | ArgusEvent[]): void {
    const batch = Array.isArray(events) ? events : [events];
    const existing = this.read();
    const ids = new Set(existing.map((event) => event.eventId));
    const lastTimestamp = existing.at(-1)?.timestamp;
    for (const event of batch) {
      const validation = validateSchema("event", event);
      if (!validation.ok) throw new Error(`Invalid event ${event.eventId}: ${validation.issues.map((issue) => `${issue.path} ${issue.message}`).join(", ")}`);
      if (ids.has(event.eventId)) throw new Error(`Duplicate event ID: ${event.eventId}`);
      if (lastTimestamp && event.timestamp < lastTimestamp) throw new Error(`Event ${event.eventId} precedes the existing ledger timestamp.`);
      ids.add(event.eventId);
    }
    appendFileSync(this.path, batch.map((event) => JSON.stringify(event)).join("\n") + "\n", { encoding: "utf8", flag: "a" });
  }
}
