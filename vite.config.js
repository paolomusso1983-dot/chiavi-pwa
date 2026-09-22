import { defineConfig } from "vite";

export default defineConfig({
  // Percorso relativo: GitHub Pages pubblica il progetto sotto <utente>.github.io/<repo>/,
  // un path assoluto "/" romperebbe gli asset. Vedi DECISIONI.md.
  base: "./",
  build: {
    outDir: "dist",
    assetsDir: "assets",
  },
  test: {
    environment: "node",
  },
});
