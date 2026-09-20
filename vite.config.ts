import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig(({ command }) => ({
  root: "web",
  // GitHub Pages serves a project site from /<repo-name>/, not the domain root — only
  // matters for a real `build` (dev/preview stay at "/")
  base: command === "build" ? "/prospector/" : "/",
  plugins: [react()],
  server: { port: 5180, open: false },
  build: { outDir: "../dist-web", emptyOutDir: true },
  test: {
    root: ".",
    include: ["engine/**/*.test.ts", "client/**/*.test.ts", "web/**/*.test.ts", "server/**/*.test.ts"],
    setupFiles: ["engine/test-provide.ts"],
  },
}));
