import { defineConfig } from "vitest/config";

// ponytail: vitest's default test glob has no root scope, so it picks up
// stray *.test.mjs files that the real Codex CLI writes into the gitignored
// codex-home/ and workspaces/ runtime dirs once the dev server has actually
// run an agent — scoping discovery to src/ (matching tsconfig's own
// "include") keeps the suite green regardless of what's sitting in those
// generated directories.
export default defineConfig({
  test: {
    include: ["src/**/*.test.ts"],
  },
});
