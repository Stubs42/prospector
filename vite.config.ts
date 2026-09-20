import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig(({ command }) => ({
  root: "web",
  // GitHub Pages serves a project site from /<repo-name>/, not the domain root — but the
  // self-hosted multiplayer server (server/main.ts) serves the same dist-web build from its
  // own root instead, so that build needs VITE_BASE_PATH=/ (see server/deploy/README.md).
  // Dev/preview always stay at "/".
  base: process.env.VITE_BASE_PATH ?? (command === "build" ? "/prospector/" : "/"),
  plugins: [react()],
  server: { port: 5180, open: false },
  build: { outDir: "../dist-web", emptyOutDir: true },
  test: {
    root: ".",
    include: ["engine/**/*.test.ts", "client/**/*.test.ts", "web/**/*.test.ts", "server/**/*.test.ts"],
    setupFiles: ["engine/test-provide.ts"],
  },
}));
