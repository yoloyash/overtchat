import { resolve } from "node:path";
import { defineConfig } from "electron-vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

const web = resolve(__dirname, "../web");
const nodeModules = resolve(__dirname, "../../node_modules");
const DEV_PORT = Number(process.env.OVERTCHAT_DESKTOP_DEV_PORT ?? 5733);

// Every dependency is bundled (they are all devDependencies), so the app ships
// no node_modules and workspace packages can export TypeScript.
export default defineConfig(({ mode }) => ({
  main: {
    build: { externalizeDeps: false, rollupOptions: { external: ["electron"] } },
  },
  preload: {
    // Sandboxed preloads must be a single CommonJS file.
    build: {
      externalizeDeps: false,
      rollupOptions: {
        external: ["electron"],
        output: { format: "cjs", entryFileNames: "[name].cjs" },
      },
    },
  },
  // The renderer bundles the web UI from `apps/web`, the same code the web
  // server serves, plus the desktop entry that boots it.
  renderer: {
    root: resolve(__dirname, "src/renderer"),
    publicDir: resolve(web, "public"),
    resolve: {
      alias: {
        "@": web,
        // The web UI and its hoisted dependencies must share one React.
        react: resolve(nodeModules, "react"),
        "react-dom": resolve(nodeModules, "react-dom"),
      },
      dedupe: ["react", "react-dom"],
    },
    define: {
      // Like Next's client bundles: server-only environment reads are empty.
      "process.env.NODE_ENV": JSON.stringify(mode === "production" ? "production" : "development"),
      "process.env": "{}",
    },
    server: {
      // The page runs at overtchat://app, so the HMR socket needs an explicit address.
      port: DEV_PORT,
      strictPort: true,
      hmr: { protocol: "ws", host: "localhost", clientPort: DEV_PORT },
    },
    build: {
      rollupOptions: { input: resolve(__dirname, "src/renderer/index.html") },
    },
    plugins: [react(), tailwindcss()],
  },
}));
