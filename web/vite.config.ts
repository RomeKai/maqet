declare const process: { env: Record<string, string | undefined> };
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import basicSsl from "@vitejs/plugin-basic-ssl";

export default defineConfig({
  plugins: [react(), tailwindcss(), basicSsl()],
  build: {
    outDir: "dist",
  },
  server: {
    proxy: {
      "/api": {
        target: process.env.MAQET_API ?? "http://localhost:8000",
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/api/, ""),
      },
    },
  },
});
