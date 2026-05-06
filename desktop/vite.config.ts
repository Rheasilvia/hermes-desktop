import { defineConfig } from "vite";
import solid from "vite-plugin-solid";
import path from "path";

export default defineConfig({
  plugins: [solid()],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
  clearScreen: false,
  server: {
    port: 1420,
    strictPort: true,
    watch: {
      // Exclude build output and Python backend dirs to avoid exhausting inotify watchers
      ignored: ['**/src-tauri/target/**', '**/backend/**'],
    },
  },
  envPrefix: ["VITE_", "TAURI_"],
});
