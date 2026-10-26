#!/usr/bin/env node
/**
 * gen:types — regenerate web/src/scene/types.ts from the Maqet FastAPI OpenAPI.
 *
 * Usage (from web/):  npm run gen:types [-- --url <openapi.json> ] [--offline]
 *
 * Tries the live server first and refreshes web/openapi.snapshot.json;
 * falls back to the snapshot so the script passes offline. Minimal emitter:
 * covers exactly what pydantic v2 generates for our Scene models
 * (objects, enums, const literals, nullable anyOf, arrays, tuples via
 * prefixItems, $refs). No dependencies — plain Node 20+.
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const SNAPSHOT = join(ROOT, "openapi.snapshot.json");
const OUT = join(ROOT, "src", "scene", "types.ts");

const args = process.argv.slice(2);
const flagValue = (name, def) => {
  const i = args.indexOf(name);
  return i >= 0 && i + 1 < args.length ? args[i + 1] : def;
};
const LIVE_URL = flagValue("--url", "http://127.0.0.1:8000/openapi.json");
const OFFLINE = args.includes("--offline");

const refName = (ref) => ref.split("/").at(-1);
const safeKey = (k) =>
  /^[A-Za-z_$][A-Za-z0-9_$]*$/.test(k) ? k : JSON.stringify(k);
const isNull = (s) =>
  typeof s === "object" && s !== null && s.type === "null" && Object.keys(s).length === 1;

function tsType(schema) {
  if (typeof schema !== "object" || schema === null) return "unknown";
  if (typeof schema.$ref === "string") return refName(schema.$ref);
  const union = schema.anyOf ?? schema.oneOf;
  if (Array.isArray(union)) {
    const parts = union.filter((s) => !isNull(s)).map(tsType);
    const t = parts.length > 1 ? `(${parts.join(" | ")})` : (parts[0] ?? "unknown");
    return union.some(isNull) ? `${t} | null` : t;
  }
  if (schema.const !== undefined) return JSON.stringify(schema.const);
  if (Array.isArray(schema.enum)) return schema.enum.map((e) => JSON.stringify(e)).join(" | ");
  if (Array.isArray(schema.allOf) && schema.allOf.length === 1) return tsType(schema.allOf[0]);
  switch (schema.type) {
    case "string":
      return "string";
    case "boolean":
      return "boolean";
    case "integer":
    case "number":
      return "number";
    case "null":
      return "null";
    case "array":
      if (Array.isArray(schema.prefixItems)) {
        return `[${schema.prefixItems.map(tsType).join(", ")}]`;
      }
      return schema.items ? `${tsType(schema.items)}[]` : "unknown[]";
    case "object":
    default:
      if (schema.properties) {
        return `{ ${objectBody(schema).join(" ")} }`;
      }
      return "unknown";
  }
}

function objectBody(schema) {
  const required = new Set(schema.required ?? []);
  return Object.entries(schema.properties ?? {}).map(
    ([k, sub]) => `${safeKey(k)}${required.has(k) ? "" : "?"}: ${tsType(sub)};`,
  );
}

function emitSchema(name, schema) {
  if (schema.properties || schema.type === "object") {
    return [`export interface ${name} {`, ...objectBody(schema), `}`].join("\n");
  }
  return `export type ${name} = ${tsType(schema)};`;
}

async function loadSpec() {
  if (!OFFLINE) {
    try {
      const res = await fetch(LIVE_URL, { signal: AbortSignal.timeout(2500) });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const spec = await res.json();
      writeFileSync(SNAPSHOT, `${JSON.stringify(spec, null, 2)}\n`);
      return { spec, from: `live ${LIVE_URL}` };
    } catch (err) {
      console.warn(`[gen:types] live OpenAPI unreachable (${err.message}); using snapshot.`);
    }
  }
  try {
    return {
      spec: JSON.parse(readFileSync(SNAPSHOT, "utf8")),
      from: `snapshot ${SNAPSHOT}`,
    };
  } catch {
    console.error("[gen:types] no snapshot found. Start the API (uvicorn server.api:app) and retry.");
    process.exit(1);
  }
}

const { spec, from } = await loadSpec();
const schemas = spec.components?.schemas ?? {};
const blocks = Object.entries(schemas).map(([name, s]) => emitSchema(name, s));
const header = `/**\n * GENERATED — do not edit.\n * Source: ${from}\n * Regenerate: npm run gen:types (from web/)\n */\n`;
mkdirSync(dirname(OUT), { recursive: true });
writeFileSync(OUT, `${header}\n${blocks.join("\n\n")}\n`);
console.log(`[gen:types] wrote src/scene/types.ts (${blocks.length} types) from ${from}`);
