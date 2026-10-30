import { defineConfig, mergeConfig } from "vitest/config";
import viteConfig from "./vite.config";

// Playwright specs live in e2e/ and run with `npm run e2e`, not vitest.
export default mergeConfig(viteConfig, defineConfig({ test: { exclude: ["e2e/**", "node_modules/**"] } }));
