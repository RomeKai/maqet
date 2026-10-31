import { existsSync } from "node:fs";
import { rmSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "@playwright/test";

const root = resolve(fileURLToPath(new URL(".", import.meta.url)), "..");
const bin = process.platform === "win32" ? "Scripts/python.exe" : "bin/python";
// A git worktree has no .venv of its own: fall back to the main checkout's (../maqet/.venv), or set E2E_PYTHON.
const candidates = [resolve(root, ".venv", bin), resolve(root, "..", "maqet", ".venv", bin)];
const python = process.env.E2E_PYTHON ?? candidates.find((p) => existsSync(p)) ?? candidates[0];

// Fresh database every run, so variants from earlier runs never leak in.
const db = resolve(root, "web", "test-results", "e2e.db");
rmSync(db, { force: true });

// Dedicated ports (never 5173/8000): vite on E2E_WEB_PORT (default 5320) proxies /api to the replay server on E2E_API_PORT (default 8020).
const webPort = process.env.E2E_WEB_PORT ?? "5320";
const apiPort = process.env.E2E_API_PORT ?? "8020";

export default defineConfig({
  testDir: "e2e",
  timeout: 60_000,
  use: { baseURL: `https://localhost:${webPort}`, ignoreHTTPSErrors: true },
  webServer: [
    {
      command: `"${python}" -m uvicorn server.api:app --port ${apiPort}`,
      cwd: root,
      url: `http://localhost:${apiPort}/health`,
      reuseExistingServer: true,
      env: { MME_MODE: "replay", MAQET_DB: db },
    },
    {
      command: `npx vite --port ${webPort} --strictPort`,
      url: `https://localhost:${webPort}`,
      ignoreHTTPSErrors: true,
      reuseExistingServer: true,
      env: { MAQET_API: `http://localhost:${apiPort}` },
    },
  ],
});
