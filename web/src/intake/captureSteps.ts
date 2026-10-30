import type { Scene } from "../scene/types";

export type CaptureStepKey = "photo" | "walls" | "openings" | "check";

export interface CaptureStep {
  key: CaptureStepKey;
  labelKey: string;
}

export const STEP_ORDER: CaptureStepKey[] = ["photo", "walls", "openings", "check"];

export const captureSteps: CaptureStep[] = [
  { key: "photo", labelKey: "capture.step.photo" },
  { key: "walls", labelKey: "capture.step.walls" },
  { key: "openings", labelKey: "capture.step.openings" },
  { key: "check", labelKey: "capture.step.check" },
];

export function captureStepFromScene(scene: Scene | null | undefined): CaptureStepKey {
  const walls = scene?.walls ?? [];
  const openings = scene?.openings ?? [];
  const rooms = scene?.rooms ?? [];
  if (walls.length === 0) return "photo";
  if (openings.length === 0 && rooms.length === 0) return "openings";
  // Presence of openings or rooms moves past walls; if any room exists we are ready to check.
  if (openings.length === 0) return "openings";
  if (rooms.length > 0) return "check";
  return "openings";
}

export function isCheckStep(step: CaptureStepKey): boolean {
  return step === "check";
}

export function shouldAutoExpandMaquette(step: CaptureStepKey): boolean {
  return step === "check";
}
