import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    coverage: {
      provider: "v8",
      include: [
        "src/lib/**/*.ts",
        "src/model/**/*.ts",
        "src/scenario/**/*.ts",
        "src/ui/present.ts",
        "src/ui/runtime.ts",
        "src/ui/blocks/view.ts",
        "src/ui/blocks/url-sync.ts",
      ],
      exclude: ["src/**/*.test.ts"],
      reporter: ["text"],
      thresholds: { statements: 100, branches: 100, functions: 100, lines: 100 },
    },
  },
});
