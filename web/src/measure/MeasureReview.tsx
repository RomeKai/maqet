import { useState } from "react";
import type { CaptureState } from "./captureSession";
import { tMeasure } from "./measure.i18n";
import { wallEditOps, openingEditOps } from "./reviewSheetOps";
import type { SceneOp } from "../scene/store";
import type { Opening } from "../scene/types";

const MIN_H = 2.0;
const MAX_H = 4.0;

export function MeasureReview({ capture, locale, onApply, onSkip }: { capture: CaptureState; locale: "en" | "es-AR"; onApply: (ops: SceneOp[]) => void; onSkip?: () => void }) {
  const walls = [...capture.walls].sort((a, b) => (b.flaggedHeight ? 1 : 0) - (a.flaggedHeight ? 1 : 0));
  const openings = [...capture.openings].sort((a, b) => (b.flagged ? 1 : 0) - (a.flagged ? 1 : 0));
  const [edits, setEdits] = useState<Record<string, { len?: number; h?: number }>>({});
  const [oEdits, setOEdits] = useState<Record<string, Partial<Opening>>>({});

  function apply() {
    const ops: SceneOp[] = [];
    for (const w of capture.walls) {
      const e = edits[w.id];
      if (e?.len !== undefined && e.len !== Math.hypot(w.end.x - w.start.x, w.end.z - w.start.z)) ops.push(...wallEditOps(w.id, e.len, e.h ?? w.heightM ?? 2.6, 0, 0).filter((o) => o.type === "setWallLength"));
      if (e?.h !== undefined && Number.isFinite(e.h) && e.h >= MIN_H && e.h <= MAX_H && e.h !== w.heightM) ops.push({ type: "setWallHeight", wallId: w.id, heightM: e.h });
    }
    for (const o of capture.openings) {
      const patch = oEdits[o.id];
      if (patch && Object.keys(patch).length) ops.push(...openingEditOps(o, patch));
    }
    onApply(ops);
  }

  return (
    <div className="measure-review" role="dialog" aria-label={tMeasure(locale, "review.title")}>
      <h3>{tMeasure(locale, "review.title")}</h3>
      <p>{tMeasure(locale, "review.hint")}</p>
      {walls.map((w) => (
        <div key={w.id} className={w.flaggedHeight ? "flagged" : ""}>
          <span>{w.id}</span>
          <input type="number" inputMode="decimal" aria-label={`${w.id} ${tMeasure(locale, "review.length")}`} defaultValue={Math.hypot(w.end.x - w.start.x, w.end.z - w.start.z).toFixed(2)} onChange={(e) => setEdits((s) => ({ ...s, [w.id]: { ...s[w.id], len: Number(e.target.value) } }))} />
          <input type="number" inputMode="decimal" aria-label={`${w.id} ${tMeasure(locale, "review.height")}`} defaultValue={w.heightM ?? ""} onChange={(e) => setEdits((s) => ({ ...s, [w.id]: { ...s[w.id], h: Number(e.target.value) } }))} />
          {w.flaggedHeight && <span>{tMeasure(locale, "review.flagged")}</span>}
        </div>
      ))}
      {openings.map((o) => (
        <div key={o.id} className={o.flagged ? "flagged" : ""}>
          <span>{o.id} {o.kind}</span>
          <input type="number" defaultValue={o.offset_m} onChange={(e) => setOEdits((s) => ({ ...s, [o.id]: { ...s[o.id], offset_m: Number(e.target.value) } }))} />
          <input type="number" defaultValue={o.width_m} onChange={(e) => setOEdits((s) => ({ ...s, [o.id]: { ...s[o.id], width_m: Number(e.target.value) } }))} />
          <input type="number" defaultValue={o.height_m} onChange={(e) => setOEdits((s) => ({ ...s, [o.id]: { ...s[o.id], height_m: Number(e.target.value) } }))} />
          {o.kind === "window" && <input type="number" defaultValue={o.sill_m ?? 0} onChange={(e) => setOEdits((s) => ({ ...s, [o.id]: { ...s[o.id], sill_m: Number(e.target.value) } }))} />}
          {o.flagged && <span>{tMeasure(locale, "review.flagged")}</span>}
        </div>
      ))}
      <div className="measure-review-actions">
        <button type="button" className="btn-primary" onClick={apply}>{tMeasure(locale, "review.apply")}</button>
        {onSkip && <button type="button" className="chip" onClick={onSkip}>{tMeasure(locale, "review.skip")}</button>}
      </div>
    </div>
  );
}
