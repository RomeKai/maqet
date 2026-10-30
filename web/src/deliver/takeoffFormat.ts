import type { Locale } from "../i18n";
import { getDeliverStrings } from "./deliver.i18n";
import type { DeliverKey } from "./deliver.i18n";
import {
  PROFESSIONAL_FLAG_CODES,
  TAKEOFF_STAGES,
  type ProfessionalFlag,
  type Takeoff,
  type TakeoffLine,
  type TakeoffStage,
} from "./takeoffTypes";

export const PRELIMINARY_NOTE = "Preliminary: not a structural certification";

const CSV_HEADER = "stage,material_id,name,quantity,unit,waste_factor,estimated,recipe_source";
const CSV_EOL = "\r\n";

export interface StageBlock {
  stage: TakeoffStage;
  lines: TakeoffLine[];
}

/** Stages that have lines, in construction order regardless of payload key order. */
export function orderedStages(takeoff: Takeoff): StageBlock[] {
  return TAKEOFF_STAGES.flatMap((stage) => {
    const lines = takeoff.stages[stage];
    return lines && lines.length > 0 ? [{ stage, lines }] : [];
  });
}

/** Locale-aware quantity: `1,234.5` in en, `1.234,5` in es-AR. */
export function formatQuantity(value: number, locale: Locale): string {
  return new Intl.NumberFormat(locale, { maximumFractionDigits: 2, useGrouping: true }).format(value);
}

function fail(what: string): never {
  throw new Error(`Invalid takeoff: ${what}`);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parseLine(stage: string, raw: unknown): TakeoffLine {
  if (!isRecord(raw)) fail(`line in stage ${stage} is not an object`);
  const { material_id, name, quantity, unit, waste_factor, recipe_source, estimated } = raw;
  if (typeof material_id !== "string") fail(`material_id in stage ${stage}`);
  // Server takeoff omits name; web fixture carries it. Fall back to material_id for display.
  const resolvedName = typeof name === "string" && name.length > 0 ? name : String(material_id);
  if (typeof quantity !== "number" || !Number.isFinite(quantity)) fail(`quantity of ${material_id}`);
  if (typeof unit !== "string") fail(`unit of ${material_id}`);
  if (typeof waste_factor !== "number" || !Number.isFinite(waste_factor)) fail(`waste_factor of ${material_id}`);
  if (typeof recipe_source !== "string") fail(`recipe_source of ${material_id}`);
  if (typeof estimated !== "boolean") fail(`estimated of ${material_id}`);
  return { material_id, name: resolvedName, quantity, unit, waste_factor, recipe_source, estimated };
}

function isStage(key: string): key is TakeoffStage {
  return (TAKEOFF_STAGES as readonly string[]).includes(key);
}

/** Localised flag text; unknown codes get the generic label. */
export function flagLabel(code: string, locale: Locale): string {
  const strings = getDeliverStrings(locale);
  const known = (PROFESSIONAL_FLAG_CODES as readonly string[]).includes(code);
  return known ? strings[`flag.${code}` as DeliverKey] : strings["flag.generic"];
}

/** Validate a takeoff payload at the network boundary. Throws on anything unexpected. */
export function parseTakeoff(raw: unknown): Takeoff {
  if (!isRecord(raw)) fail("takeoff is not an object");
  if (raw.preliminary !== true) fail("takeoff must be marked preliminary");
  // Flags: web shape is flags:[{code}], server shape is professional_flags:[str]
  const flagSource: unknown = (raw as Record<string, unknown>).flags ?? (raw as Record<string, unknown>).professional_flags;
  if (!Array.isArray(flagSource)) fail("flags must be a list");
  const flags: ProfessionalFlag[] = flagSource.map((flag: unknown) => {
    if (typeof flag === "string") return { code: flag };
    if (!isRecord(flag) || typeof flag.code !== "string") fail("professional flag without a code");
    return { code: flag.code };
  });
  // Stages: web is Record<stage, lines[]>, server is [{name, items:[]}]
  const stages: Takeoff["stages"] = {};
  const rawStages: unknown = (raw as Record<string, unknown>).stages;
  if (Array.isArray(rawStages)) {
    for (const entry of rawStages as unknown[]) {
      if (!isRecord(entry) || typeof entry.name !== "string") fail("stage entry must have a name");
      const key = entry.name as string;
      if (!isStage(key)) fail(`unknown stage "${key}"`);
      const lines: unknown = (entry as Record<string, unknown>).items ?? (entry as Record<string, unknown>).lines;
      if (!Array.isArray(lines)) fail(`stage ${key} must be a list`);
      stages[key as TakeoffStage] = lines.map((line: unknown) => parseLine(key, line));
    }
  } else if (isRecord(rawStages)) {
    for (const [key, lines] of Object.entries(rawStages)) {
      if (!isStage(key)) fail(`unknown stage "${key}"`);
      if (!Array.isArray(lines)) fail(`stage ${key} must be a list`);
      stages[key] = lines.map((line: unknown) => parseLine(key, line));
    }
  } else {
    fail("stages must be an object or list");
  }
  return { preliminary: true, flags, stages };
}

/** Quote a CSV cell; text cells starting with a formula character are defused first. */
function csvText(value: string): string {
  const safe = /^[=+\-@\t\r]/.test(value) ? `'${value}` : value;
  return /[",\r\n]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
}

/**
 * Takeoff as CSV, built client-side from the data. Machine-readable on purpose
 * (dot decimals, English headers) so it opens the same in any spreadsheet locale.
 */
export function buildTakeoffCsv(takeoff: Takeoff): string {
  const rows = orderedStages(takeoff).flatMap(({ stage, lines }) =>
    lines.map((line) =>
      [
        stage,
        csvText(line.material_id),
        csvText(line.name),
        String(line.quantity),
        csvText(line.unit),
        String(line.waste_factor),
        String(line.estimated),
        csvText(line.recipe_source),
      ].join(","),
    ),
  );
  const flagRows = takeoff.flags.map((flag) => `flag,${csvText(flag.code)},${csvText(flagLabel(flag.code, "en"))}`);
  return [CSV_HEADER, ...rows, PRELIMINARY_NOTE, ...flagRows].join(CSV_EOL) + CSV_EOL;
}

const REVOKE_DELAY_MS = 1000;

/** Trigger a browser download of the CSV. UTF-8 BOM so spreadsheets keep accents. */
export function downloadCsv(csv: string, filename: string): void {
  const url = URL.createObjectURL(new Blob(["﻿", csv], { type: "text/csv;charset=utf-8" }));
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  // Firefox ignores clicks on detached anchors; revoke late so the download can start.
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), REVOKE_DELAY_MS);
}
