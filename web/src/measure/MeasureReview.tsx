import { useState } from "react";
import { roomSanity, round2, type CaptureState } from "./captureSession";
import { modeLabel, tMeasure } from "./measure.i18n";
import { wallEditOps, openingEditOps } from "./reviewSheetOps";
import type { SceneOp } from "../scene/store";
import type { Opening } from "../scene/types";

const MIN_H = 2.0;
const MAX_H = 4.0;

/** Accepts "2,4" and "2.4"; null for anything that is not a positive number. */
export function parseDecimalInput(raw: string): number | null {
  const n = Number(raw.trim().replace(",", "."));
  return raw.trim() !== "" && Number.isFinite(n) && n > 0 ? n : null;
}

/** Display value: 2 decimals, locale separator. Full precision stays in the capture state. */
export function showDecimal(n: number, locale: "en" | "es-AR"): string {
  const s = round2(n).toFixed(2);
  return locale === "es-AR" ? s.replace(".", ",") : s;
}

function wallNumber(id: string, fallback: number): number {
  const m = /(\d+)$/.exec(id);
  return m ? Number(m[1]) : fallback;
}

interface FieldProps {
  label: string;
  value: string;
  invalid?: boolean;
  onChange: (raw: string) => void;
}

function Field({ label, value, invalid, onChange }: FieldProps) {
  return (
    <label className={`review-field${invalid === true ? " review-field-bad" : ""}`}>
      <span className="review-field-label">{label}</span>
      <input
        type="text"
        inputMode="decimal"
        defaultValue={value}
        aria-invalid={invalid === true}
        onChange={(e) => onChange(e.target.value)}
      />
    </label>
  );
}

type WallEdit = { len?: number | null; h?: number | null };
type OpeningEdit = Partial<Record<"offset_m" | "width_m" | "height_m" | "sill_m", number | null>>;

export function MeasureReview({ capture, locale, onApply, onSkip }: { capture: CaptureState; locale: "en" | "es-AR"; onApply: (ops: SceneOp[]) => void; onSkip?: () => void }) {
  const [edits, setEdits] = useState<Record<string, WallEdit>>({});
  const [oEdits, setOEdits] = useState<Record<string, OpeningEdit>>({});
  const sanity = roomSanity(capture.walls);

  const wallLen = (w: CaptureState["walls"][number]) => Math.hypot(w.end.x - w.start.x, w.end.z - w.start.z);

  function apply() {
    const ops: SceneOp[] = [];
    for (const w of capture.walls) {
      const e = edits[w.id];
      if (e === undefined) continue;
      if (typeof e.len === "number" && Math.abs(e.len - round2(wallLen(w))) > 1e-9) {
        ops.push(...wallEditOps(w.id, e.len, e.h ?? w.heightM ?? 2.6, 0, 0).filter((o) => o.type === "setWallLength"));
      }
      if (typeof e.h === "number" && e.h >= MIN_H && e.h <= MAX_H && e.h !== round2(w.heightM ?? 0)) {
        ops.push({ type: "setWallHeight", wallId: w.id, heightM: e.h });
      }
    }
    for (const o of capture.openings) {
      const raw = oEdits[o.id];
      if (raw === undefined) continue;
      const patch: Partial<Opening> = {};
      for (const [k, v] of Object.entries(raw)) {
        if (typeof v === "number") (patch as Record<string, number>)[k] = v;
      }
      if (Object.keys(patch).length > 0) ops.push(...openingEditOps(o, patch));
    }
    onApply(ops);
  }

  const setWall = (id: string, key: "len" | "h", raw: string) =>
    setEdits((s) => ({ ...s, [id]: { ...s[id], [key]: parseDecimalInput(raw) } }));
  const setOpening = (id: string, key: keyof OpeningEdit, raw: string) =>
    setOEdits((s) => ({ ...s, [id]: { ...s[id], [key]: key === "sill_m" && raw.trim() === "0" ? 0 : parseDecimalInput(raw) } }));

  return (
    <div className="measure-review" role="dialog" aria-label={tMeasure(locale, "review.title")}>
      <h3>{tMeasure(locale, "review.title")}</h3>
      <p className="measure-review-hint">{tMeasure(locale, "review.hint")}</p>
      {sanity.tooSmall && (
        <p className="measure-review-warning" role="alert">{tMeasure(locale, "review.small")}</p>
      )}
      {capture.walls.map((w, i) => {
        const e = edits[w.id];
        const hBad = e?.h !== undefined && (e.h === null || e.h < MIN_H || e.h > MAX_H);
        return (
          <section key={w.id} className={`review-card${w.flaggedHeight ? " flagged" : ""}`}>
            <h4>
              {tMeasure(locale, "review.wall", { n: wallNumber(w.id, i + 1) })}
              {w.flaggedHeight && <span className="review-flag">{tMeasure(locale, "review.flagged")}</span>}
            </h4>
            <div className="review-row">
              <Field label={tMeasure(locale, "review.lengthM")} value={showDecimal(wallLen(w), locale)} invalid={e?.len === null} onChange={(r) => setWall(w.id, "len", r)} />
              <Field label={tMeasure(locale, "review.heightM")} value={w.heightM === null ? "" : showDecimal(w.heightM, locale)} invalid={hBad} onChange={(r) => setWall(w.id, "h", r)} />
            </div>
          </section>
        );
      })}
      {capture.openings.map((o) => {
        const wall = capture.walls.find((w) => w.id === o.wall_id);
        const n = wall ? wallNumber(wall.id, 0) : 0;
        const kind = modeLabel(locale, o.kind);
        const e = oEdits[o.id];
        return (
          <section key={o.id} className={`review-card review-card-${o.kind}${o.flagged ? " flagged" : ""}`}>
            <h4>
              {tMeasure(locale, "review.openingOn", { kind, n })}
              {o.flagged && <span className="review-flag">{tMeasure(locale, "review.flagged")}</span>}
            </h4>
            <div className="review-row">
              <Field label={tMeasure(locale, "review.widthM")} value={showDecimal(o.width_m, locale)} invalid={e?.width_m === null} onChange={(r) => setOpening(o.id, "width_m", r)} />
              <Field label={tMeasure(locale, "review.offsetM")} value={showDecimal(o.offset_m, locale)} onChange={(r) => setOpening(o.id, "offset_m", r)} />
              <Field label={tMeasure(locale, "review.heightM")} value={showDecimal(o.height_m, locale)} invalid={e?.height_m === null} onChange={(r) => setOpening(o.id, "height_m", r)} />
              {o.kind === "window" && (
                <Field label={tMeasure(locale, "review.sillM")} value={showDecimal(o.sill_m ?? 0, locale)} onChange={(r) => setOpening(o.id, "sill_m", r)} />
              )}
            </div>
          </section>
        );
      })}
      <div className="measure-review-actions">
        <button type="button" className="chip chip-primary" onClick={apply}>{tMeasure(locale, "review.apply")}</button>
        {onSkip && <button type="button" className="chip" onClick={onSkip}>{tMeasure(locale, "review.skip")}</button>}
      </div>
    </div>
  );
}
