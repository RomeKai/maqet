import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import type { Scene, Wall } from "../scene/types";
import {
  applySceneOp,
  isWallEstimated,
  wallDisplayLengthM,
  type SceneOp,
} from "../scene/store";
import { getStrings, type Locale } from "../i18n";
import type { IntakeProposal } from "./api";
import {
  formToPlacement,
  openPlacemenFromSnappedTap,
  placementToOpening,
  snapPointToWallPx,
  placeOpeningAtTap,
  placementToOpening as placementToOpeningFn,
  WALL_HIT_TOL_PX,
  TAP_SLOP_PX,
  DOOR_MIN_WIDTH_M,
  validateAgainstWall,
} from "./opening";
import { fitPlan, planToCanvas, canvasToPlan } from "./fitPlan";
import { StepHeader } from "./StepHeader";
import { CheckList } from "./CheckList";
import { buildChecks } from "./checks";
import { Button, cn } from "../ui";
import { WallLengthSheet } from "./WallLengthSheet";
import { OpeningSheet } from "./OpeningSheet";
import { STEP_ORDER, type CaptureStepKey } from "./captureSteps";
import { pillMetrics, provenanceKind, type ProvenanceKind } from "./wallPill";

export type CornerTool = "select" | "addWall" | "door" | "window";

interface Point {
  x: number;
  y: number;
}

interface CornerEditorProps {
  locale: Locale;
  scene: Scene;
  proposal?: IntakeProposal | null;
  imageUrl: string | null;
  imageWidth: number;
  imageHeight: number;
  onChange: (scene: Scene, op: SceneOp) => void;
  onUndo: () => void;
  canUndo: boolean;
  /** Reading notices from the server (Check step list). */
  warnings?: string[];
  /** Fired whenever the Photo > Walls > Openings > Check step changes. */
  onStepChange?: (step: CaptureStepKey) => void;
  /** "Looks right" on the Check step: move on to the next stage. */
  onLooksRight?: () => void;
  /** Step to open on when the scene is seeded (default: Walls). */
  initialStep?: CaptureStepKey;
  /** Secondary text links shown under the toolbar on the Walls step. */
  wallsExtras?: ReactNode;
}

function wallId(): string {
  return `w${Math.random().toString(36).slice(2, 8)}`;
}

function openingId(): string {
  return `o${Math.random().toString(36).slice(2, 8)}`;
}

const WALL_LEN_M = 3;

/** Screen-px minimum for wall length labels (AA, readable at a glance). */
export const WALL_LABEL_MIN_PX = 14;
export const wallLabelClass = "wall-label";

/** Narrow door warning threshold (meters) — door kept but flagged. */
export { DOOR_MIN_WIDTH_M };

/**
 * Photo-space calibration (BUG1 fix): the editor canvas is photo pixels,
 * the Scene is meters. The normalized proposal (0..1, y-down) is the bridge.
 * We align the proposal bbox (in photo px) with the Scene bbox (meters) to
 * recover meters-per-pixel plus origin. Display mapping only — the Scene
 * stays meters, source of truth (ADR-001), geometry untouched.
 */
export interface PhotoCalibration {
  metersPerPx: number;
  sceneMinX: number;
  sceneMaxY: number;
  propMinXPx: number;
  propMinYPx: number;
}

export function calibratePhotoSpace(
  proposal: IntakeProposal | null | undefined,
  scene: Scene,
  imageWidth: number,
  imageHeight: number,
): PhotoCalibration | null {
  if (proposal === null || proposal === undefined) return null;
  if (imageWidth <= 0 || imageHeight <= 0) return null;
  const walls = proposal.walls ?? [];
  if (walls.length === 0) return null;

  let pMinX = Infinity;
  let pMaxX = -Infinity;
  let pMinY = Infinity;
  let pMaxY = -Infinity;
  for (const w of walls) {
    for (const p of [w.a, w.b]) {
      if (p[0] < pMinX) pMinX = p[0];
      if (p[0] > pMaxX) pMaxX = p[0];
      if (p[1] < pMinY) pMinY = p[1];
      if (p[1] > pMaxY) pMaxY = p[1];
    }
  }
  if (!(pMaxX > pMinX) && !(pMaxY > pMinY)) return null;
  const propWpx = (pMaxX - pMinX) * imageWidth;
  const propHpx = (pMaxY - pMinY) * imageHeight;
  if (propWpx <= 0 && propHpx <= 0) return null;

  const sceneWalls = scene.walls ?? [];
  if (sceneWalls.length === 0) return null;
  let sMinX = Infinity;
  let sMaxX = -Infinity;
  let sMinY = Infinity;
  let sMaxY = -Infinity;
  for (const w of sceneWalls) {
    for (const p of [w.a, w.b]) {
      if (p[0] < sMinX) sMinX = p[0];
      if (p[0] > sMaxX) sMaxX = p[0];
      if (p[1] < sMinY) sMinY = p[1];
      if (p[1] > sMaxY) sMaxY = p[1];
    }
  }
  const sceneW = sMaxX - sMinX;
  const sceneH = sMaxY - sMinY;
  if (!(sceneW > 0) && !(sceneH > 0)) return null;

  let metersPerPx = 0;
  let count = 0;
  if (propWpx > 0 && sceneW > 0) {
    metersPerPx += sceneW / propWpx;
    count += 1;
  }
  if (propHpx > 0 && sceneH > 0) {
    metersPerPx += sceneH / propHpx;
    count += 1;
  }
  if (count === 0) return null;
  metersPerPx /= count;

  return {
    metersPerPx,
    sceneMinX: sMinX,
    sceneMaxY: sMaxY,
    propMinXPx: pMinX * imageWidth,
    propMinYPx: pMinY * imageHeight,
  };
}

export function sceneToPhoto(cal: PhotoCalibration, x: number, y: number): Point {
  return {
    x: cal.propMinXPx + (x - cal.sceneMinX) / cal.metersPerPx,
    y: cal.propMinYPx + (cal.sceneMaxY - y) / cal.metersPerPx,
  };
}

export function photoToScene(cal: PhotoCalibration, px: number, py: number): Point {
  return {
    x: cal.sceneMinX + (px - cal.propMinXPx) * cal.metersPerPx,
    y: cal.sceneMaxY - (py - cal.propMinYPx) * cal.metersPerPx,
  };
}

export interface DragPreview {
  wallId: string;
  end: "a" | "b";
  point: Point;
}

export interface SharedHandle {
  members: { wallId: string; end: "a" | "b" }[];
  point: [number, number];
}

/** Display-space distance below which endpoints merge into one handle. */
export const HANDLE_CLUSTER_PX = 12;

/** Meters equiv of 12 px when no photo calibration maps px to meters. */
export const HANDLE_CLUSTER_M = 0.05;

/**
 * One handle per shared corner: cluster endpoints in display space (~12 px).
 * Pure so the clustering rule is unit-testable; the test counts handles.
 */
export function clusterHandles(
  walls: Wall[],
  toDisplay: (x: number, y: number) => Point,
  preview: DragPreview | null,
  tolPx: number = HANDLE_CLUSTER_PX,
): SharedHandle[] {
  const handles: SharedHandle[] = [];
  for (const wall of walls) {
    for (const end of ["a", "b"] as const) {
      const raw = previewEndpoint(wall, end, preview);
      const p = toDisplay(raw[0], raw[1]);
      const existing = handles.find((h) => {
        const dp = toDisplay(h.point[0], h.point[1]);
        return Math.hypot(dp.x - p.x, dp.y - p.y) <= tolPx;
      });
      if (existing === undefined) {
        handles.push({ members: [{ wallId: wall.id, end }], point: [raw[0], raw[1]] });
      } else {
        existing.members.push({ wallId: wall.id, end });
      }
    }
  }
  return handles;
}

/** Walls sharing the dragged handle move together (one op per wall). */
export function handleMembersFor(
  handles: SharedHandle[],
  wallId: string,
  end: "a" | "b",
): SharedHandle | undefined {
  return handles.find((h) => h.members.some((m) => m.wallId === wallId && m.end === end));
}

/** "W1" style 1-based wall number for the selected-element label. */
export function wallNumber(walls: Wall[], wallId: string): number {
  const idx = walls.findIndex((w) => w.id === wallId);
  return idx >= 0 ? idx + 1 : 0;
}

/**
 * Effective endpoint for rendering: the live finger position while a corner
 * drag is in flight, else the stored Scene endpoint. Pure so the render
 * branch is unit-testable; pointer handlers only set/clear the preview and
 * commit one op on pointerup (no Scene/3D updates mid-drag).
 */
export function previewEndpoint(
  wall: Wall,
  end: "a" | "b",
  preview: DragPreview | null,
): [number, number] {
  if (preview !== null && preview.wallId === wall.id && preview.end === end) {
    return [preview.point.x, preview.point.y];
  }
  return end === "a" ? wall.a : wall.b;
}

/**
 * 2D plan corner editor (P0): SVG over the photo, draggable endpoints
 * (≥44 px touch targets), add/remove wall, mark door/window.
 * Every edit is a Scene op, reported to the parent store via onChange.
 * The Scene stays meters (ADR-001); the SVG is photo-pixel space fed by the
 * normalized proposal mapping, never by raw Scene meters.
 */
export function CornerEditor({
  locale,
  scene,
  proposal = null,
  imageUrl,
  imageWidth,
  imageHeight,
  onChange,
  onUndo,
  canUndo,
  initialSelectedWallId = null,
  initialPreview = null,
  warnings = [],
  onStepChange,
  onLooksRight,
  initialStep = "walls",
  wallsExtras,
}: CornerEditorProps & {
  initialSelectedWallId?: string | null;
  initialPreview?: DragPreview | null;
}) {
  const t = getStrings(locale);
  const [tool, setTool] = useState<CornerTool>("select");
  const [selectedWall, setSelectedWall] = useState<string | null>(initialSelectedWallId);
  const [selectedOpening, setSelectedOpening] = useState<string | null>(null);
  const [pendingStart, setPendingStart] = useState<Point | null>(null);
  /** Live finger position mid-drag: local render only, never emitted. */
  const [preview, setPreview] = useState<DragPreview | null>(initialPreview);
  const svgRef = useRef<SVGSVGElement>(null);

  /** Placing an opening: wall + kind, then two taps (or form). */
  const [placing, setPlacing] = useState<{ wallId: string; kind: "door" | "window"; firstTap: [number, number] | null } | null>(null);
  const [tapPreview, setTapPreview] = useState<[number, number] | null>(null);
  const [openingError, setOpeningError] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [formVals, setFormVals] = useState({ offset: "", width: "", height: "", sill: "" });

  const walls = useMemo(() => scene.walls ?? [], [scene.walls]);
  const openings = useMemo(() => scene.openings ?? [], [scene.openings]);
  // Step is user-driven (Next / Back); an empty scene always means Photo.
  const [userStep, setUserStep] = useState<CaptureStepKey>(initialStep);
  const step: CaptureStepKey = walls.length === 0 ? "photo" : userStep;
  useEffect(() => {
    onStepChange?.(step);
  }, [step, onStepChange]);
  const checks = useMemo(() => buildChecks(scene, warnings, t), [scene, warnings, t]);
  const stepIndex = STEP_ORDER.indexOf(step);
  const [highlightWallId, setHighlightWallId] = useState<string | null>(null);
  /** Wall under the finger while an opening tool is active. */
  const [hoverWallId, setHoverWallId] = useState<string | null>(null);
  const openingGesture = useRef<{ x: number; y: number } | null>(null);
  const [wallSheetId, setWallSheetId] = useState<string | null>(null);
  const [openingSheetId, setOpeningSheetId] = useState<string | null>(null);

  /** SVG viewBox units per screen px: keeps pills >= 14 px at any photo zoom. */
  const [unitsPerPx, setUnitsPerPx] = useState(1);

  // No photo: fit the plan to a virtual canvas so it fills the view with a margin.
  const fit = useMemo(
    () => (imageWidth <= 0 && walls.length > 0 ? fitPlan(walls) : null),
    [imageWidth, walls],
  );
  const canvasW = fit !== null ? fit.canvasW : imageWidth > 0 ? imageWidth : WALL_LEN_M * 2;
  const canvasH = fit !== null ? fit.canvasH : imageHeight > 0 ? imageHeight : WALL_LEN_M * 2;

  const calibration = useMemo(
    () => calibratePhotoSpace(proposal, scene, imageWidth, imageHeight),
    [proposal, scene, imageWidth, imageHeight],
  );

  useEffect(() => {
    const svg = svgRef.current;
    if (svg === null || typeof ResizeObserver === "undefined") return;
    const measure = (): void => {
      const w = svg.getBoundingClientRect().width;
      if (w > 0) setUnitsPerPx(canvasW / w);
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(svg);
    return () => ro.disconnect();
  }, [canvasW]);

  function toSceneCoords(clientX: number, clientY: number): Point {
    const svg = svgRef.current;
    if (svg === null) return { x: 0, y: 0 };
    const rect = svg.getBoundingClientRect();
    const px = ((clientX - rect.left) / rect.width) * canvasW;
    const py = ((clientY - rect.top) / rect.height) * canvasH;
    if (calibration !== null) return photoToScene(calibration, px, py);
    if (fit !== null) return canvasToPlan(fit, px, py);
    return { x: px, y: py };
  }

  /** Scene meters -> display (photo px) for SVG + handle positions. */
  function toDisplay(x: number, y: number): Point {
    if (calibration === null) return fit !== null ? planToCanvas(fit, x, y) : { x, y };
    return sceneToPhoto(calibration, x, y);
  }

  /** Shared corner handles, recomputed from display positions each render. */
  const handles = useMemo(
    () => clusterHandles(
      walls,
      toDisplay,
      preview,
      calibration !== null || fit !== null ? HANDLE_CLUSTER_PX : HANDLE_CLUSTER_M,
    ),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [walls, calibration, fit, preview],
  );

  /** Walls touched by the in-flight drag: highlighted while preview active. */
  const draggingWallIds = useMemo(() => {
    if (preview === null) return new Set<string>();
    const h = handleMembersFor(handles, preview.wallId, preview.end);
    return new Set((h?.members ?? [{ wallId: preview.wallId }]).map((m) => m.wallId));
  }, [handles, preview]);

  /** Locale length: JetBrains Mono in CSS, comma decimals for es-AR. */
  function formatLengthM(meters: number): string {
    const fixed = meters.toFixed(2);
    return locale === "es-AR" ? `${fixed.replace(".", ",")} m` : `${fixed} m`;
  }

  const selectedWallObj = selectedWall !== null
    ? walls.find((w) => w.id === selectedWall) ?? null
    : null;
  const selectedOpeningObj = selectedOpening !== null
    ? openings.find((o) => o.id === selectedOpening) ?? null
    : null;

  function emit(op: SceneOp): void {
    onChange(applySceneOp(scene, op), op);
  }

  function startPlacing(wallIdValue: string, kind: "door" | "window"): void {
    setPlacing({ wallId: wallIdValue, kind, firstTap: null });
    setTapPreview(null);
    setOpeningError(null);
    setShowForm(false);
    const wall = walls.find((w) => w.id === wallIdValue);
    if (wall !== undefined) {
      const wallLen = Math.hypot(wall.b[0] - wall.a[0], wall.b[1] - wall.a[1]);
      const defW = kind === "door" ? 0.9 : 1.4;
      const defH = kind === "door" ? 2.05 : 1.4;
      setFormVals({
        offset: (Math.max(0, (wallLen - defW) / 2)).toFixed(2),
        width: defW.toFixed(2),
        height: defH.toFixed(2),
        sill: "0.80",
      });
    }
  }

  const openingToolKind: "door" | "window" | null = tool === "door" || tool === "window" ? tool : null;

  /** Wall the finger would hit (tolerance in screen px, converted to canvas units). */
  function wallUnderFinger(clientX: number, clientY: number): { wall: Wall } | null {
    const p = toSceneCoords(clientX, clientY);
    const snap = snapPointToWallPx([p.x, p.y], walls, toDisplay, WALL_HIT_TOL_PX * unitsPerPx);
    return snap === null ? null : { wall: snap.wall };
  }

  /** One tap: default-size opening centred at the tap, then open its edit sheet. */
  function placeOpeningOneTap(clientX: number, clientY: number, kind: "door" | "window"): void {
    const p = toSceneCoords(clientX, clientY);
    const hit = placeOpeningAtTap(walls, toDisplay, kind, [p.x, p.y], WALL_HIT_TOL_PX * unitsPerPx);
    if (hit === null) {
      setOpeningError(t["intake.opening.outsideWall"]);
      return;
    }
    const id = openingId();
    setOpeningError(null);
    emit({ type: "markOpening", opening: placementToOpeningFn(hit.placement, id) });
    setSelectedWall(hit.wall.id);
    setSelectedOpening(id);
    setOpeningSheetId(id);
    setTool("select");
  }

  function handleCanvasTap(clientX: number, clientY: number): void {
    if (openingToolKind !== null) return; // handled by pointer events
    if (tool === "addWall") {
      const p = toSceneCoords(clientX, clientY);
      if (pendingStart === null) {
        setPendingStart(p);
        return;
      }
      const wall: Wall = {
        id: wallId(),
        a: [pendingStart.x, pendingStart.y],
        b: [p.x, p.y],
        thickness_m: 0.1,
        kind: "interior",
      };
      setPendingStart(null);
      emit({ type: "addWall", wall });
      return;
    }
    // Opening placement: snap to nearest wall within 24 screen px.
    if (placing !== null) {
      const p = toSceneCoords(clientX, clientY);
      const raw: [number, number] = [p.x, p.y];
      const snap = snapPointToWallPx(raw, walls, toDisplay, 24);
      if (snap === null) {
        setOpeningError(t["intake.opening.outsideWall"]);
        return;
      }
      const snappedWall = snap.wall;
      // adopt wall under tap if placing wall mismatched
      const activePlacing = placing.wallId !== snappedWall.id ? { ...placing, wallId: snappedWall.id } : placing;
      if (activePlacing.firstTap === null) {
        setPlacing({ ...activePlacing, firstTap: snap.point });
        setTapPreview(null);
        setOpeningError(null);
        return;
      }
      const result = openPlacemenFromSnappedTap(snappedWall as Wall, activePlacing.kind, activePlacing.firstTap, snap.point);
      if ("rejected" in result) {
        setOpeningError(t["intake.opening.outsideWall"]);
        return;
      }
      const validation = validateAgainstWall(snappedWall as Wall, result.placement.offset_m, result.placement.width_m);
      if (validation !== null) {
        setOpeningError(t["intake.opening.outsideWall"]);
        return;
      }
      setOpeningError(null);
      emit({ type: "markOpening", opening: placementToOpening(result.placement, openingId()) });
      setPlacing(null);
      setTapPreview(null);
      setTool("select");
    }
  }

  function handleEndpointDragEnd(wallIdValue: string, end: "a" | "b", clientX: number, clientY: number): void {
    const p = toSceneCoords(clientX, clientY);
    // Shared corner: every wall meeting at this handle moves together.
    const members = handleMembersFor(handles, wallIdValue, end)?.members
      ?? [{ wallId: wallIdValue, end }];
    const ops: SceneOp[] = members.map((m) => ({
      type: "moveWallEndpoint" as const, wallId: m.wallId, end: m.end, point: [p.x, p.y] as [number, number],
    }));
    // One history step per drag, however many walls share the corner.
    emit(ops.length === 1 ? ops[0]! : { type: "batch", ops });
  }

  function handleFormConfirm(): void {
    if (placing === null) return;
    const wall = walls.find((w) => w.id === placing.wallId);
    if (wall === undefined) {
      setOpeningError(t["intake.opening.outsideWall"]);
      return;
    }
    const offset = Number.parseFloat(formVals.offset.replace(",", "."));
    const width = Number.parseFloat(formVals.width.replace(",", "."));
    const height = Number.parseFloat(formVals.height.replace(",", "."));
    const sill = placing.kind === "window" ? Number.parseFloat(formVals.sill.replace(",", ".")) : null;
    const result = formToPlacement({
      wallId: placing.wallId,
      kind: placing.kind,
      wallOffsetM: offset,
      widthM: width,
      heightM: height,
      sillM: sill,
    });
    if ("rejected" in result) {
      setOpeningError(t["intake.opening.outsideWall"]);
      return;
    }
    if (placing.kind === "window" && Number.isFinite(sill as number) === false) {
      setOpeningError(t["intake.opening.outsideWall"]);
      return;
    }
    const validation = validateAgainstWall(wall, result.placement.offset_m, result.placement.width_m);
    if (validation !== null) {
      setOpeningError(t["intake.opening.outsideWall"]);
      return;
    }
    setOpeningError(null);
    emit({ type: "markOpening", opening: placementToOpening(result.placement, openingId()) });
    setPlacing(null);
    setTapPreview(null);
    setShowForm(false);
    setTool("select");
  }

  function handleMarkOpening(kind: "door" | "window"): void {
    if (selectedWall === null) return;
    const wall = walls.find((w) => w.id === selectedWall);
    if (wall === undefined) return;
    // New flow: enter two-tap placing mode (or form). Do NOT emit until confirmed.
    startPlacing(wall.id, kind);
  }

  function handleRemoveWall(): void {
    if (selectedWall === null) return;
    emit({ type: "removeWall", wallId: selectedWall });
    setSelectedWall(null);
  }

  const toolButtons: { tool: CornerTool; label: string }[] = [
    { tool: "select", label: t["intake.tool.select"] },
    { tool: "addWall", label: t["intake.tool.addWall"] },
    { tool: "door", label: t["intake.tool.door"] },
    { tool: "window", label: t["intake.tool.window"] },
  ];

  const proposalWalls = useMemo(() => (fit !== null ? [] : proposal?.walls ?? []), [proposal, fit]);
  const proposalDims = useMemo(() => (fit !== null ? [] : proposal?.dimensions ?? []), [proposal, fit]);
  const proposalOpenings = useMemo(() => (fit !== null ? [] : proposal?.openings ?? []), [proposal, fit]);

  const instruction = placing
    ? (placing.firstTap === null ? t["intake.opening.tapPrompt"] : `${t["intake.opening.tapPrompt"]} (1/2)`)
    : pendingStart !== null
      ? t["intake.tapSecond"]
      : step === "photo"
        ? t["intake.upload.hint"]
        : step === "walls"
          ? t["intake.scale.hint"]
          : step === "openings"
            ? t["intake.opening.tapPrompt"]
            : checks.length === 0
              ? t["intake.checks.none"]
              : t["intake.checks.tapHint"];

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3 font-sans">
      <StepHeader locale={locale} step={step} error={openingError} instruction={instruction} />
      {step === "check" && (
        <CheckList
          locale={locale}
          items={checks}
          highlightedWallId={highlightWallId}
          onSelect={(item) => {
            setHighlightWallId(item.wallId);
            setSelectedWall(item.wallId);
          }}
        />
      )}

      <div
        className="intake-canvas"
        style={fit !== null
          ? { flex: "none", aspectRatio: `${canvasW} / ${canvasH}`, width: `min(100%, calc(55dvh * ${canvasW / canvasH}))`, margin: "0 auto" }
          : undefined}
      >
        {imageUrl !== null && (
          <img src={imageUrl} alt="" className="intake-photo" draggable={false} />
        )}
        <svg
          ref={svgRef}
          className="intake-svg"
          viewBox={`0 0 ${canvasW} ${canvasH}`}
          role="application"
          aria-label={t["intake.editor"]}
          onClick={(e) => handleCanvasTap(e.clientX, e.clientY)}
          onPointerDown={(e) => {
            if (openingToolKind === null) return;
            openingGesture.current = { x: e.clientX, y: e.clientY };
            setHoverWallId(wallUnderFinger(e.clientX, e.clientY)?.wall.id ?? null);
          }}
          onPointerUp={(e) => {
            const start = openingGesture.current;
            openingGesture.current = null;
            setHoverWallId(null);
            if (openingToolKind === null || start === null) return;
            if (Math.hypot(e.clientX - start.x, e.clientY - start.y) < TAP_SLOP_PX) {
              placeOpeningOneTap(e.clientX, e.clientY, openingToolKind);
            }
          }}
          onPointerCancel={() => { openingGesture.current = null; setHoverWallId(null); }}
          onPointerMove={(e) => {
            if (openingGesture.current !== null) {
              setHoverWallId(wallUnderFinger(e.clientX, e.clientY)?.wall.id ?? null);
            }
            if (placing === null || placing.firstTap === null) return;
            const p = toSceneCoords(e.clientX, e.clientY);
            setTapPreview([p.x, p.y]);
          }}
        >
          {proposalWalls.map((w, i) => (
            <line
              key={`proposal-${i}`}
              x1={w.a[0] * canvasW}
              y1={w.a[1] * canvasH}
              x2={w.b[0] * canvasW}
              y2={w.b[1] * canvasH}
              className="proposal-wall"
              stroke="#2F5D62"
              strokeWidth={1.5}
            />
          ))}
          {proposalDims.map((d, i) => (
            <g key={`dim-${i}`} className="proposal-dim">
              <line
                x1={d.a[0] * canvasW}
                y1={d.a[1] * canvasH}
                x2={d.b[0] * canvasW}
                y2={d.b[1] * canvasH}
                stroke="#2F5D62"
                strokeWidth={1}
                strokeDasharray="4 2"
              />
              <text
                x={(d.a[0] + d.b[0]) / 2 * canvasW}
                y={(d.a[1] + d.b[1]) / 2 * canvasH}
                fill="#2F5D62"
                fontSize={12}
              >
                {d.text}
              </text>
            </g>
          ))}
          {proposalOpenings.map((o, i) => {
            const wall = proposalWalls[o.wall_index];
            if (wall === undefined) return null;
            const ax = wall.a[0] * canvasW;
            const ay = wall.a[1] * canvasH;
            const bx = wall.b[0] * canvasW;
            const by = wall.b[1] * canvasH;
            return (
              <line
                key={`proposal-opening-${i}`}
                x1={ax + (bx - ax) * o.t0}
                y1={ay + (by - ay) * o.t0}
                x2={ax + (bx - ax) * o.t1}
                y2={ay + (by - ay) * o.t1}
                className={o.kind === "door" ? "proposal-opening-door" : "proposal-opening-window"}
              />
            );
          })}
          {walls.map((w) => {
            const a = toDisplay(...previewEndpoint(w, "a", preview));
            const b = toDisplay(...previewEndpoint(w, "b", preview));
            const dragging = preview !== null && draggingWallIds.has(w.id);
            const isHighlight = highlightWallId === w.id || hoverWallId === w.id;
            const cls = [
              "wall",
              w.kind === "interior" ? "wall-interior" : "wall-exterior",
              selectedWall === w.id ? "wall-selected" : "",
              isWallEstimated(w) ? "wall-estimated" : "",
              dragging ? "wall-dragging" : "",
              isHighlight ? "wall-highlight" : "",
            ].filter(Boolean).join(" ");
            return (
              <g key={w.id}>
                <line
                  x1={a.x}
                  y1={a.y}
                  x2={b.x}
                  y2={b.y}
                  className={cls}
                  onClick={(e) => {
                    e.stopPropagation();
                    setSelectedWall(w.id);
                    setSelectedOpening(null);
                    setWallSheetId(w.id);
                  }}
                />
                <WallPill
                  cx={(a.x + b.x) / 2}
                  cy={(a.y + b.y) / 2}
                  label={`W${wallNumber(walls, w.id)} · ${formatLengthM(wallDisplayLengthM(w))}`}
                  kind={provenanceKind(w)}
                  badge={t[`intake.prov.${provenanceKind(w)}` as const]}
                  unitsPerPx={unitsPerPx}
                  onSelect={() => { setSelectedWall(w.id); setWallSheetId(w.id); }}
                />
              </g>
            );
          })}
          {openings.map((o) => {
            const wall = walls.find((w) => w.id === o.wall_id);
            if (wall === undefined) return null;
            const len = Math.hypot(wall.b[0] - wall.a[0], wall.b[1] - wall.a[1]);
            if (len <= 0) return null;
            const ux = (wall.b[0] - wall.a[0]) / len;
            const uy = (wall.b[1] - wall.a[1]) / len;
            const s0 = toDisplay(wall.a[0] + ux * o.offset_m, wall.a[1] + uy * o.offset_m);
            const s1 = toDisplay(
              wall.a[0] + ux * (o.offset_m + o.width_m),
              wall.a[1] + uy * (o.offset_m + o.width_m),
            );
            if (o.kind === "door") {
              const mx = s1.x - s0.x;
              const my = s1.y - s0.y;
              const mLen = Math.hypot(mx, my);
              const tx = mLen > 0 ? mx / mLen : 0;
              const ty = mLen > 0 ? my / mLen : 1;
              const nx = ty;
              const ny = -tx;
              const r = mLen;
              const arcEnd = { x: s0.x + r * nx, y: s0.y + r * ny };
              const arcD = `M ${s0.x} ${s0.y} A ${r} ${r} 0 0 1 ${arcEnd.x} ${arcEnd.y}`;
              const doorCls = ["opening-door", selectedOpening === o.id ? "opening-selected" : ""].filter(Boolean).join(" ");
              return (
                <g key={o.id}>
                  <line x1={s0.x} y1={s0.y} x2={s1.x} y2={s1.y} className="opening-door-gap" />
                  <line x1={s0.x} y1={s0.y} x2={s1.x} y2={s1.y} className={doorCls} onClick={(e) => { e.stopPropagation(); setSelectedOpening(o.id); setSelectedWall(wall.id); if (placing === null) setOpeningSheetId(o.id); }} />
                  <path d={arcD} className="opening-door-arc" />
                  {selectedOpening === o.id && (<text x={(s0.x + s1.x) / 2} y={(s0.y + s1.y) / 2} className="wall-label">{`${t["intake.selected.door"]} · ${formatLengthM(o.width_m)}`}</text>)}
                </g>
              );
            }
            const mx = s1.x - s0.x;
            const my = s1.y - s0.y;
            const mLen = Math.hypot(mx, my);
            const tx = mLen > 0 ? mx / mLen : 0;
            const ty = mLen > 0 ? my / mLen : 1;
            const nx = ty;
            const ny = -tx;
            const off = 3;
            const winCls = ["opening-window", selectedOpening === o.id ? "opening-selected" : ""].filter(Boolean).join(" ");
            const wA0 = { x: s0.x + nx * off, y: s0.y + ny * off };
            const wA1 = { x: s1.x + nx * off, y: s1.y + ny * off };
            const wB0 = { x: s0.x - nx * off, y: s0.y - ny * off };
            const wB1 = { x: s1.x - nx * off, y: s1.y - ny * off };
            return (
              <g key={o.id}>
                <line x1={wA0.x} y1={wA0.y} x2={wA1.x} y2={wA1.y} className={winCls} onClick={(e) => { e.stopPropagation(); setSelectedOpening(o.id); setSelectedWall(wall.id); if (placing === null) setOpeningSheetId(o.id); }} />
                <line x1={wB0.x} y1={wB0.y} x2={wB1.x} y2={wB1.y} className={winCls} onClick={(e) => { e.stopPropagation(); setSelectedOpening(o.id); setSelectedWall(wall.id); if (placing === null) setOpeningSheetId(o.id); }} />
                {selectedOpening === o.id && (<text x={(s0.x + s1.x) / 2} y={(s0.y + s1.y) / 2} className="wall-label">{`${t["intake.selected.window"]} · ${formatLengthM(o.width_m)}`}</text>)}
              </g>
            );
          })}
          {openingToolKind === null && openings.map((o) => {
            const wall = walls.find((w) => w.id === o.wall_id);
            if (wall === undefined) return null;
            const len = Math.hypot(wall.b[0] - wall.a[0], wall.b[1] - wall.a[1]);
            if (len <= 0) return null;
            const ux = (wall.b[0] - wall.a[0]) / len;
            const uy = (wall.b[1] - wall.a[1]) / len;
            const s0 = toDisplay(wall.a[0] + ux * o.offset_m, wall.a[1] + uy * o.offset_m);
            const s1 = toDisplay(wall.a[0] + ux * (o.offset_m + o.width_m), wall.a[1] + uy * (o.offset_m + o.width_m));
            return (
              <line
                key={`hit-${o.id}`}
                x1={s0.x} y1={s0.y} x2={s1.x} y2={s1.y}
                className="opening-hit"
                data-opening-id={o.id}
                onClick={(e) => {
                  e.stopPropagation();
                  setSelectedOpening(o.id);
                  setSelectedWall(wall.id);
                  if (placing === null) setOpeningSheetId(o.id);
                }}
              />
            );
          })}
        </svg>
        {handles.map((h, i) => {
          const dp = toDisplay(h.point[0], h.point[1]);
          const active = preview !== null
            && h.members.some((m) => m.wallId === preview.wallId && m.end === preview.end);
          const first = h.members[0]!;
          return (
            <button
              key={`handle-${i}`}
              type="button"
              className={active ? "handle-btn handle-active" : "handle-btn"}
              aria-label={t["intake.editor"]}
              style={{
                left: `${(dp.x / canvasW) * 100}%`,
                top: `${(dp.y / canvasH) * 100}%`,
              }}
              onPointerDown={(e) => {
                e.stopPropagation();
                (e.target as HTMLButtonElement).setPointerCapture(e.pointerId);
              }}
              onPointerMove={(e) => {
                if (!e.buttons) return;
                e.stopPropagation();
                setPreview({
                  wallId: first.wallId,
                  end: first.end,
                  point: toSceneCoords(e.clientX, e.clientY),
                });
              }}
              onPointerUp={(e) => {
                e.stopPropagation();
                const moved = preview !== null;
                setPreview(null);
                // A bare tap (no move) must not nudge the corner.
                if (moved) handleEndpointDragEnd(first.wallId, first.end, e.clientX, e.clientY);
              }}
              onPointerCancel={() => setPreview(null)}
            />
          );
        })}
      </div>

      {selectedWallObj !== null && (
        <p className="intake-selected-label" role="status">
          {t["intake.selected.wall"]
            .replace("{n}", String(wallNumber(walls, selectedWallObj.id)))
            .replace("{length}", formatLengthM(wallDisplayLengthM(selectedWallObj)))}
        </p>
      )}
      {openingToolKind !== null && (
        <p className="intake-selected-label" role="status">
          {openingToolKind === "door" ? t["intake.opening.tapHintDoor"] : t["intake.opening.tapHintWindow"]}
        </p>
      )}
      {selectedOpeningObj !== null && (
        <p className="intake-selected-label" role="status">
          {(selectedOpeningObj.kind === "door"
            ? t["intake.selected.door"]
            : t["intake.selected.window"]
          ).replace("{width}", formatLengthM(selectedOpeningObj.width_m))}
          {selectedOpeningObj.kind === "door" && selectedOpeningObj.width_m < DOOR_MIN_WIDTH_M ? ` · ${t["intake.opening.narrowDoor"]}` : ""}
        </p>
      )}

      {selectedWall !== null && placing === null && (
        <div className="flex flex-wrap gap-2">
          {step === "openings" && (
            <>
              <Button variant="secondary" onClick={() => handleMarkOpening("door")}>
                {t["intake.markDoor"]}
              </Button>
              <Button variant="secondary" onClick={() => handleMarkOpening("window")}>
                {t["intake.markWindow"]}
              </Button>
            </>
          )}
          {step === "walls" && (
            <Button variant="danger" onClick={handleRemoveWall}>
              {t["intake.removeWall"]}
            </Button>
          )}
        </div>
      )}

      {placing !== null && (
        <div className="intake-opening">
          <p className="intake-hint" role="status">
            {placing.firstTap === null
              ? `${t["intake.opening.tapPrompt"]} — ${t["intake.selected.wall"].replace("{n}", String(wallNumber(walls, placing.wallId)))}`
              : `${t["intake.opening.tapPrompt"]} (1/2)`}
          </p>
          {openingError !== null && (
            <p className="intake-error" role="alert">{openingError}</p>
          )}
          {placing.kind === "door" && openings.some((o) => o.kind === "door" && o.width_m < DOOR_MIN_WIDTH_M) === false && (
            // live preview of narrow check is on form/tap result; no-op placeholder to keep strings reachable
            <span style={{ display: "none" }}>{t["intake.opening.narrowDoor"]}</span>
          )}
          {tapPreview !== null && placing.firstTap !== null && (
            <svg className="intake-opening-preview" viewBox={`0 0 ${canvasW} ${canvasH}`} aria-hidden>
              {(() => {
                const wall = walls.find((w) => w.id === placing.wallId);
                if (wall === undefined) return null;
                const p0 = toDisplay(placing.firstTap[0], placing.firstTap[1]);
                const p1 = toDisplay(tapPreview[0], tapPreview[1]);
                return <line x1={p0.x} y1={p0.y} x2={p1.x} y2={p1.y} className="opening-preview" strokeDasharray="4 4" stroke="#0ea5e9" strokeWidth={2} />;
              })()}
            </svg>
          )}
          <div className="flex gap-2">
            <Button variant="secondary" className="flex-1" onClick={() => setShowForm((v) => !v)}>
              {t["intake.opening.useForm"]}
            </Button>
            <Button
              variant="ghost"
              className="flex-1"
              onClick={() => {
                setPlacing(null);
                setTapPreview(null);
                setOpeningError(null);
                setShowForm(false);
              }}
            >
              {t["intake.undo"]}
            </Button>
          </div>
          {showForm && (
            <div className="flex flex-col gap-3 rounded-xl border-2 border-border bg-card p-3" role="group" aria-label={t["intake.opening.confirm"]}>
              <label className="flex flex-col gap-1 text-[15px] font-bold">
                {t["intake.opening.distance"]}
                <input
                  className="min-h-12 rounded-xl border-2 border-input bg-background px-3 font-mono text-lg"
                  type="text"
                  inputMode="decimal"
                  value={formVals.offset}
                  onChange={(e) => setFormVals((s) => ({ ...s, offset: e.target.value }))}
                />
              </label>
              <label className="flex flex-col gap-1 text-[15px] font-bold">
                {t["intake.opening.width"]}
                <input
                  className="min-h-12 rounded-xl border-2 border-input bg-background px-3 font-mono text-lg"
                  type="text"
                  inputMode="decimal"
                  value={formVals.width}
                  onChange={(e) => setFormVals((s) => ({ ...s, width: e.target.value }))}
                />
              </label>
              <label className="flex flex-col gap-1 text-[15px] font-bold">
                {t["intake.opening.height"]}
                <input
                  className="min-h-12 rounded-xl border-2 border-input bg-background px-3 font-mono text-lg"
                  type="text"
                  inputMode="decimal"
                  value={formVals.height}
                  onChange={(e) => setFormVals((s) => ({ ...s, height: e.target.value }))}
                />
              </label>
              {placing.kind === "window" && (
                <label className="flex flex-col gap-1 text-[15px] font-bold">
                  {t["intake.opening.sill"]}
                  <input
                    className="min-h-12 rounded-xl border-2 border-input bg-background px-3 font-mono text-lg"
                    type="text"
                    inputMode="decimal"
                    value={formVals.sill}
                    onChange={(e) => setFormVals((s) => ({ ...s, sill: e.target.value }))}
                  />
                </label>
              )}
              <Button onClick={handleFormConfirm}>{t["intake.opening.confirm"]}</Button>
              {placing.kind === "door" && Number.parseFloat(formVals.width.replace(",", ".")) > 0
                && Number.parseFloat(formVals.width.replace(",", ".")) < DOOR_MIN_WIDTH_M && (
                <span className="text-[15px] font-bold text-danger">{t["intake.opening.narrowDoor"]}</span>
              )}
            </div>
          )}
        </div>
      )}

      {wallSheetId && (() => {
        const w = walls.find((x) => x.id === wallSheetId);
        if (!w) return null;
        return (
          <WallLengthSheet
            locale={locale}
            wall={w}
            wallNumber={wallNumber(walls, w.id)}
            onSave={(op) => onChange(applySceneOp(scene, op), op)}
            onClose={() => setWallSheetId(null)}
          />
        );
      })()}

      {openingSheetId !== null && (() => {
        const o = openings.find((x) => x.id === openingSheetId);
        const w = o !== undefined ? walls.find((x) => x.id === o.wall_id) : undefined;
        if (o === undefined || w === undefined) return null;
        return (
          <OpeningSheet
            locale={locale}
            opening={o}
            wall={w}
            onSave={(ops) => { let next = scene; for (const op of ops) { next = applySceneOp(next, op); onChange(next, op); } }}
            onRemove={() => { emit({ type: "removeOpening", openingId: o.id }); setSelectedOpening(null); }}
            onClose={() => setOpeningSheetId(null)}
          />
        );
      })()}

      {step !== "check" && step !== "photo" && (
        <div
          className="sticky bottom-0 flex gap-1 rounded-2xl bg-secondary p-1"
          role="toolbar"
          aria-label={t["intake.editor"]}
        >
          {toolButtons.map((b) => (
            <button
              key={b.tool}
              type="button"
              className={cn(
                "min-h-12 flex-1 rounded-xl px-1 text-[15px] font-bold",
                tool === b.tool ? "bg-foreground text-background" : "text-foreground",
              )}
              aria-pressed={tool === b.tool}
              onClick={() => {
                setTool(b.tool);
              }}
            >
              {b.label}
            </button>
          ))}
          <button
            type="button"
            className="min-h-12 flex-1 rounded-xl px-1 text-[15px] font-bold text-foreground disabled:opacity-40"
            onClick={onUndo}
            disabled={!canUndo}
          >
            {t["intake.undo"]}
          </button>
        </div>
      )}

      {step === "walls" && wallsExtras}

      {step !== "photo" && (
        <div className="flex gap-2">
          {stepIndex > 1 && (
            <Button variant="secondary" onClick={() => setUserStep(STEP_ORDER[stepIndex - 1] ?? "walls")}>
              {t["intake.prevStep"]}
            </Button>
          )}
          {step === "check" ? (
            <Button className="flex-1" onClick={onLooksRight}>
              {t["intake.looksRight"]}
            </Button>
          ) : (
            <Button className="flex-1" onClick={() => setUserStep(STEP_ORDER[stepIndex + 1] ?? "check")}>
              {t["intake.next"]}
            </Button>
          )}
        </div>
      )}

    </div>
  );
}

const PILL_TONE: Record<ProvenanceKind, { fill: string; text: string; stroke: string }> = {
  written: { fill: "var(--foreground)", text: "var(--background)", stroke: "var(--foreground)" },
  measured: { fill: "var(--measured)", text: "#fff", stroke: "var(--measured)" },
  estimated: { fill: "var(--warning)", text: "var(--warning-foreground)", stroke: "var(--warning-foreground)" },
};

function WallPill({
  cx,
  cy,
  label,
  kind,
  badge,
  unitsPerPx,
  onSelect,
}: {
  cx: number;
  cy: number;
  label: string;
  kind: ProvenanceKind;
  badge: string;
  unitsPerPx: number;
  onSelect: () => void;
}) {
  const main = pillMetrics(label, unitsPerPx);
  const sub = pillMetrics(badge, unitsPerPx);
  const w = Math.max(main.widthUnits, sub.widthUnits);
  const h = main.heightUnits + sub.heightUnits * 0.8;
  const tone = PILL_TONE[kind];
  return (
    <g
      className="wall-pill"
      data-provenance={kind}
      onClick={(e) => {
        e.stopPropagation();
        onSelect();
      }}
    >
      <rect
        x={cx - w / 2}
        y={cy - h / 2}
        width={w}
        height={h}
        rx={main.fontUnits * 0.6}
        style={{ fill: tone.fill, stroke: tone.stroke }}
        strokeWidth={main.fontUnits * 0.1}
        strokeDasharray={kind === "estimated" ? `${main.fontUnits * 0.35} ${main.fontUnits * 0.25}` : undefined}
      />
      <text
        x={cx}
        y={cy - h / 2 + main.heightUnits / 2 + main.fontUnits * 0.35}
        className={wallLabelClass}
        style={{ fill: tone.text, fontSize: main.fontUnits, fontWeight: 700 }}
      >
        {label}
      </text>
      <text
        x={cx}
        y={cy + h / 2 - sub.fontUnits * 0.45}
        className="wall-badge"
        style={{ fill: tone.text, fontSize: sub.fontUnits, fontWeight: 600, textAnchor: "middle" }}
      >
        {badge}
      </text>
    </g>
  );
}
