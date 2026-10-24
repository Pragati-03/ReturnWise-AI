import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      // Vite resolves "/src" relative to the project root,
      // so no Node-only imports are needed.
      "@": "/src",
    },
  },
  server: {
    port: 5173,
  },
  test: {
    globals: true,
    environment: "jsdom",
    setupFiles: ["./src/test/setup.ts"],
    css: false,
    env: { VITE_API_BASE_URL: "" },
  },
});