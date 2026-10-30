import { defineConfig } from "@playwright/test";

// Dedicated ports (never 5173/8000): vite on 5320 proxies /api to the replay server on 8020.
export default defineConfig({
  testDir: "e2e",
  timeout: 60_000,
  use: { baseURL: "https://localhost:5320", ignoreHTTPSErrors: true },
  webServer: [
    {
      command: "cd .. && .venv/Scripts/python -m uvicorn server.api:app --port 8020",
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
