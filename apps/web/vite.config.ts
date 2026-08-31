import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      "/api": "http://127.0.0.1:3000",
    },
  },
  test: {
    environment: "jsdom",
    setupFiles: ["./src/test/setup.ts"],
    // Comfortably above the async-utility budget in setup.ts, so a slow wait
    // fails on its own assertion rather than on the test deadline.
    testTimeout: 30_000,
  },
});
