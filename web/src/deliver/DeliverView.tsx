import { useEffect, useState } from "react";
import { FileDown, ShieldAlert } from "lucide-react";
import type { Locale } from "../i18n";
import type { Scene } from "../scene/types";
import { isWallEstimated } from "../scene/store";
import { Banner, Button } from "../ui";
import { getDeliverStrings } from "./deliver.i18n";
import { NextSteps } from "./NextSteps";
import { TakeoffView } from "./TakeoffView";
import type { Takeoff } from "./takeoffTypes";
import { downloadCsv } from "./takeoffFormat";

function apiBase(): string {
  const configured: unknown = import.meta.env.VITE_API_URL;
  return typeof configured === "string" && configured.length > 0 ? configured : "/api";
}

/** Render the CURRENT scene (POST), not whatever the server stored: GET could be stale or missing. */
async function fetchSnapshotUrl(scene: Scene, locale: Locale): Promise<string | null> {
  try {
    const res = await fetch(`${apiBase()}/scene/snapshot.svg?locale=${encodeURIComponent(locale === "es-AR" ? "es-AR" : "en")}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(scene),
    });
    if (!res.ok) return null;
    return URL.createObjectURL(await res.blob());
  } catch {
    return null;
  }
}

interface DeliverViewProps {
  scene: Scene | null;
  takeoff: Takeoff | null;
  locale: Locale;
}

export function DeliverView({ scene, takeoff, locale }: DeliverViewProps): React.JSX.Element {
  const t = getDeliverStrings(locale);
  const [dxfBusy, setDxfBusy] = useState(false);
  const [dxfError, setDxfError] = useState<string | null>(null);
  const [csvBusy, setCsvBusy] = useState(false);
  const [csvError, setCsvError] = useState<string | null>(null);
  const estimatedWalls = (scene?.walls ?? []).filter(isWallEstimated).length;

  // Snapshot of the current scene; stays null (card hidden) when it cannot be rendered.
  const [snapshot, setSnapshot] = useState<string | null>(null);
  useEffect(() => {
    if (!scene || (scene.walls?.length ?? 0) === 0) {
      setSnapshot(null);
      return;
    }
    let live = true;
    let created: string | null = null;
    void fetchSnapshotUrl(scene, locale).then((url) => {
      created = url;
      if (live) setSnapshot(url);
      else if (url) URL.revokeObjectURL(url);
    });
    return () => {
      live = false;
      if (created) URL.revokeObjectURL(created);
    };
  }, [scene, locale]);

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
    <div className="flex min-h-0 w-full flex-1 flex-col self-stretch bg-background font-sans" data-testid="deliver-view">
      <div className="shrink-0 border-b border-border px-3 py-2">
        <p
          className="flex items-center gap-2 rounded-xl border-2 border-foreground bg-card px-3 py-2 text-[15px] font-bold leading-snug"
          data-testid="preliminary-label"
        >
          <ShieldAlert className="size-5 shrink-0 text-danger" aria-hidden />
          {t["footer.preliminary"]}
        </p>
      </div>

      <div className="min-h-0 flex-1 space-y-3 overflow-y-auto p-3">
        {csvError ? <Banner tone="danger" title={t["csv.error.title"]}>{csvError}</Banner> : null}
        {dxfError ? (
          <Banner
            tone="danger"
            title={t["dxf.error.title"]}
            action={
              <Button variant="danger" onClick={() => void downloadDxf()}>
                {t["action.retry"]}
              </Button>
            }
          >
            {dxfError}
          </Banner>
        ) : null}

        {estimatedWalls > 0 ? (
          <Banner tone="warning" title={t["walls.estimated.title"].replace("{n}", String(estimatedWalls))}>
            {t["walls.estimated.body"]}
          </Banner>
        ) : scene?.walls?.length ? (
          <Banner tone="success" title={t["walls.confirmed.title"]}>
            {t["walls.confirmed.body"]}
          </Banner>
        ) : null}

        {snapshot ? (
          <div className="overflow-hidden rounded-xl border-2 border-border bg-card">
            <img src={snapshot} alt={t["snapshot.alt"]} className="block w-full" onError={() => setSnapshot(null)} />
          </div>
        ) : null}

        {takeoff ? <TakeoffView takeoff={takeoff} locale={locale} /> : null}

        <NextSteps locale={locale} estimatedWalls={estimatedWalls} flagCount={takeoff?.flags.length ?? 0} />
      </div>

      <div className="shrink-0 space-y-2 border-t-2 border-foreground bg-card p-3">
        <Button className="w-full" onClick={() => void downloadDxf()} disabled={dxfBusy || !scene}>
          <FileDown className="size-5" aria-hidden />
          {dxfBusy ? t["action.preparing"] : t["action.dxf"]}
        </Button>
        <Button variant="secondary" className="w-full" onClick={() => void downloadCsvFile()} disabled={csvBusy || !scene}>
          {csvBusy ? t["action.preparing"] : t["action.exportCsv"]}
        </Button>
        <p className="text-center text-sm text-muted-foreground">{t["dxf.hint"]}</p>
      </div>
    </div>
  );
}
