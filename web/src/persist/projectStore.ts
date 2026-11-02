import type { Locale, StringKey } from "../i18n";
import type { CaptureStepKey } from "../intake/captureSteps";
import type { ChatMessage } from "../agent/agentTypes";
import type { OpRecordIn, Scene } from "../scene/types";
import { STAGES } from "../shell/Stepper";

/** Bump when the snapshot shape changes: an older store is then ignored, never half-read. */
export const PROJECT_KEY = "maqet.project.v1";

export interface StorageLike {
  getItem: (key: string) => string | null;
  setItem: (key: string, value: string) => void;
  removeItem: (key: string) => void;
}

/** Everything a reload must bring back: scene per variant, op history, chats, stage and locale. */
export interface ProjectSnapshot {
  v: 1;
  locale: Locale;
  stage: StringKey;
  captureStep: CaptureStepKey;
  scene: Scene;
  /** Reform "Now" baseline (read-only), null outside Reform. */
  baseScene: Scene | null;
  variants: Record<string, { scene: Scene; ops: OpRecordIn[] }>;
  history: OpRecordIn[];
  chats: Record<string, ChatMessage[]>;
  professionalFlags: string[];
}

const LOCALES: readonly string[] = ["en", "es-AR"];
const CAPTURE_STEPS: readonly string[] = ["photo", "walls", "openings", "check"];

/** localStorage can throw (private mode, blocked site data) or be absent (SSR, tests). */
export function browserStorage(): StorageLike | null {
  try {
    return typeof window === "undefined" ? null : window.localStorage;
  } catch {
    return null;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isSnapshot(value: unknown): value is ProjectSnapshot {
  if (!isRecord(value) || value.v !== 1) return false;
  if (typeof value.locale !== "string" || !LOCALES.includes(value.locale)) return false;
  if (typeof value.stage !== "string" || !STAGES.includes(value.stage as StringKey)) return false;
  if (typeof value.captureStep !== "string" || !CAPTURE_STEPS.includes(value.captureStep)) return false;
  if (!isRecord(value.scene)) return false;
  if (value.baseScene !== null && !isRecord(value.baseScene)) return false;
  if (!Array.isArray(value.history) || !Array.isArray(value.professionalFlags)) return false;
  if (!isRecord(value.variants) || !Object.values(value.variants).every((v) => isRecord(v) && isRecord(v.scene) && Array.isArray(v.ops))) return false;
  if (!isRecord(value.chats) || !Object.values(value.chats).every(Array.isArray)) return false;
  return true;
}

export function saveProject(snapshot: ProjectSnapshot, storage: StorageLike | null = browserStorage()): boolean {
  if (storage === null) return false;
  try {
    storage.setItem(PROJECT_KEY, JSON.stringify(snapshot));
    return true;
  } catch {
    return false;
  }
}

export function clearProject(storage: StorageLike | null = browserStorage()): void {
  try {
    storage?.removeItem(PROJECT_KEY);
  } catch {
    // Nothing to clear when storage is blocked.
  }
}

/** The stored project, or null when absent, unreadable or of another shape (a corrupt store is dropped). */
export function loadProject(storage: StorageLike | null = browserStorage()): ProjectSnapshot | null {
  if (storage === null) return null;
  let raw: string | null;
  try {
    raw = storage.getItem(PROJECT_KEY);
  } catch {
    return null;
  }
  if (raw === null) return null;
  try {
    const parsed: unknown = JSON.parse(raw);
    if (isSnapshot(parsed)) return parsed;
  } catch {
    // Fall through: corrupt JSON is handled like a wrong shape.
  }
  clearProject(storage);
  return null;
}
