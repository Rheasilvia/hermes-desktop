import { defineConfig } from "vite";
import solid from "vite-plugin-solid";
import path from "path";
import { readFileSync } from "fs";
import { execSync } from "child_process";

// Build-time version identifier (shown bottom-left of the sidebar).
const pkg = JSON.parse(readFileSync(path.resolve(__dirname, "package.json"), "utf-8"));
let commitHash = "unknown";
try {
  commitHash = execSync("git rev-parse --short HEAD", { cwd: __dirname }).toString().trim();
} catch {
  // Not a git checkout (e.g. packaged source build) — leave as "unknown".
}

export default defineConfig({
  plugins: [solid()],
  define: {
    __APP_VERSION__: JSON.stringify(pkg.version),
    __APP_COMMIT__: JSON.stringify(commitHash),
  },
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
      ignored: ['**/src-tauri/target/**', '**/sidecar/**'],
    },
  },
  envPrefix: ["VITE_", "TAURI_"],
});
