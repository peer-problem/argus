import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["lab/**/*.test.ts", "apps/argus-trace/src/**/*.test.ts"],
    coverage: { reporter: ["text", "html"] }
  }
});
