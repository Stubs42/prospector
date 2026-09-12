import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  root: "web",
  plugins: [react()],
  server: { port: 5180, open: false },
  build: { outDir: "../dist-web", emptyOutDir: true },
  test: {
    root: ".",
    include: ["engine/**/*.test.ts", "client/**/*.test.ts", "web/**/*.test.ts"],
    setupFiles: ["engine/test-provide.ts"],
  },
});
