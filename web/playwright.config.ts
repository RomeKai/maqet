import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "@playwright/test";

const root = resolve(fileURLToPath(new URL(".", import.meta.url)), "..");
const python = resolve(root, ".venv", process.platform === "win32" ? "Scripts/python.exe" : "bin/python");

// Dedicated ports (never 5173/8000): vite on 5320 proxies /api to the replay server on 8020.
export default defineConfig({
  testDir: "e2e",
  timeout: 60_000,
  use: { baseURL: "https://localhost:5320", ignoreHTTPSErrors: true },
  webServer: [
    {
      command: `"${python}" -m uvicorn server.api:app --port 8020`,
      cwd: root,
      url: "http://localhost:8020/health",
      reuseExistingServer: true,
      env: { MME_MODE: "replay" },
    },
    {
      command: "npx vite --port 5320 --strictPort",
      url: "https://localhost:5320",
      ignoreHTTPSErrors: true,
      reuseExistingServer: true,
      env: { MAQET_API: "http://localhost:8020" },
    },
  ],
});
