import { defineConfig } from "vitest/config";
import path from "node:path";

export default defineConfig({
  test: {
    // Default env is node; component tests opt into jsdom via `// @vitest-environment jsdom`.
    environment: "node",
    include: ["src/**/*.test.ts", "src/**/*.test.tsx", "tests/**/*.test.ts", "tests/**/*.test.tsx"],
    testTimeout: 30_000,
    hookTimeout: 30_000,
    coverage: {
      provider: "v8",
      reporter: ["text", "text-summary", "json-summary", "html", "lcov"],
      reportsDirectory: "./coverage",
      include: ["src/**/*.{ts,tsx}"],
      exclude: [
        "src/**/*.test.{ts,tsx}",
        "src/**/*.d.ts",
        "src/routeTree.gen.ts",
        "src/integrations/supabase/**",
        "src/components/ui/**",
      ],
      // Agreed minimum coverage floor. Fails the run (and CI) if any
      // metric drops below these thresholds. Raise deliberately — never
      // lower without team sign-off.
      thresholds: {
        lines: 50,
        statements: 50,
        functions: 45,
        branches: 40,
      },
    },
  },
  resolve: {
    alias: { "@": path.resolve(__dirname, "src") },
  },
});
