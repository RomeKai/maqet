import { useEffect, useState } from "react";
import type { Locale } from "../i18n";
import type { Scene } from "../scene/types";
import { getDeliverStrings } from "./deliver.i18n";
import { TakeoffView } from "./TakeoffView";
import type { Takeoff } from "./takeoffTypes";
import { downloadCsv } from "./takeoffFormat";

function apiBase(): string {
  const configured: unknown = import.meta.env.VITE_API_URL;
  return typeof configured === "string" && configured.length > 0 ? configured : "/api";
}

function snapshotSrc(locale: Locale): string {
  return `${apiBase()}/scene/snapshot.svg?locale=${encodeURIComponent(locale)}`;
}

interface DeliverViewProps {
  scene: Scene | null;
  takeoff: Takeoff | null;
  locale: Locale;
}

export function DeliverView({ scene, takeoff, locale }: DeliverViewProps): React.JSX.Element {
  const t = getDeliverStrings(locale);
  const [dxfBusy, setDxfBusy] = useState(false);
  const [csvBusy, setCsvBusy] = useState(false);
  const [csvError, setCsvError] = useState<string | null>(null);
  const [dxfError, setDxfError] = useState<string | null>(null);

  // Bust snapshot cache when scene version changes
  const [snapKey, setSnapKey] = useState(0);
  useEffect(() => {
    setSnapKey((k) => k + 1);
  }, [scene?.version, locale]);

  async function downloadCsvFile(): Promise<void> {
    if (!scene) return;
    setCsvBusy(true);
    setCsvError(null);
    try {
      const res = await fetch(`${apiBase()}/export/takeoff.csv`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ scene }),
      });
      if (!res.ok) throw new Error((await res.text().catch(() => "")) || `CSV export failed (${res.status})`);
      const csv = await res.text();
      downloadCsv(csv, "takeoff.csv");
    } catch (err) {
      setCsvError(err instanceof Error ? err.message : String(err));
    } finally { setCsvBusy(false); }
  }

  async function downloadDxf(): Promise<void> {
    if (!scene) return;
    setDxfBusy(true);
    setDxfError(null);
    try {
      const res = await fetch(`${apiBase()}/export/dxf`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(scene),
      });
      if (!res.ok) {
        const text = await res.text().catch(() => "");
        throw new Error(text.slice(0, 300) || `DXF export failed (${res.status})`);
      }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = "scene.dxf";
      a.click();
      URL.revokeObjectURL(url);
    } catch (err) {
      setDxfError(err instanceof Error ? err.message : String(err));
    } finally {
      setDxfBusy(false);
    }
  }

  return (
    <div className="deliver-view" data-testid="deliver-view">
      <div className="deliver-snapshot-row">
        <div className="deliver-snapshot">
          <img
            key={snapKey}
            src={snapshotSrc(locale)}
            alt="Plan snapshot"
            className="deliver-snapshot-img"
            loading="lazy"
          />
        </div>
        <div className="deliver-dxf">
          <button type="button" className="deliver-export" onClick={() => void downloadDxf()} disabled={dxfBusy || !scene}>
            {dxfBusy ? "…" : "DXF"}
          </button>
          {dxfError ? <p className="deliver-error">{dxfError}</p> : null}
          <button type="button" className="deliver-export" onClick={() => void downloadCsvFile()} disabled={csvBusy || !scene}>
            {csvBusy ? "…" : t["action.exportCsv"]}
          </button>
          {csvError ? <p className="deliver-error">{csvError}</p> : null}
        </div>
      </div>
      <p className="preliminary" data-testid="preliminary-label">
        {t["footer.preliminary"]}
      </p>
      {takeoff ? <TakeoffView takeoff={takeoff} locale={locale} /> : null}
    </div>
  );
}
