import { useEffect, useRef, useState } from "react";
import { Box, Share2 } from "lucide-react";
import { getStrings, type Locale } from "../i18n";
import { uploadArModel } from "../ar/uploadArModel";
import type { MaquetteFiles } from "../ar/buildMaquetteFiles";
import type { Scene } from "../scene/types";
import { SceneView } from "../view3d/SceneView";
import { DEFAULT_SCALE_DENOMINATOR, ScaleSelector, type MaquetteScale } from "../ar/ScaleSelector";
import { MaquetteViewer } from "../ar/MaquetteViewer";
import { getArStrings } from "../ar/ar.i18n";
import type { ModelViewerElement } from "../ar/model-viewer.d";
import { USDZ_MIME, useMaquetteUrl } from "../ar/useMaquetteUrl";
import { ConnectedVariantTabs } from "../agent/VariantTabs";
import { Banner, Button } from "../ui";

interface PresentViewProps {
  scene: Scene | null;
  locale: Locale;
  selectedWallId: string | null;
  onSelectWall: (wallId: string) => void;
  onSceneChange: (scene: Scene) => void;
  /** Test seam: replaces the clipboard write. */
  copyLink?: (url: string) => Promise<void>;
}

type ShareState = "idle" | "copied" | "failed";

/** Present stage: full 3D, variants, AR on the table, share link. */
export function PresentView({ scene, locale, selectedWallId, onSelectWall, onSceneChange, copyLink }: PresentViewProps): React.JSX.Element {
  const t = getStrings(locale);
  const [files, setFiles] = useState<MaquetteFiles | null>(null);
  const [hosted, setHosted] = useState<{ glb: string | null; usdz: string | null }>({ glb: null, usdz: null });
  const [building, setBuilding] = useState(false);
  /** The GLB/USDZ upload for external AR apps is in flight (or not started). */
  const [hosting, setHosting] = useState(false);
  const [arError, setArError] = useState(false);
  const [share, setShare] = useState<ShareState>("idle");
  const [scaleDenominator, setScaleDenominator] = useState<MaquetteScale>(DEFAULT_SCALE_DENOMINATOR);
  const viewerRef = useRef<ModelViewerElement | null>(null);
  const glbUrl = useMaquetteUrl(files?.glb ?? null);
  const usdzUrl = useMaquetteUrl(files?.usdz ?? null, USDZ_MIME);
  const hasPlan = scene !== null && (scene.walls?.length ?? 0) > 0;

  // Build GLB + USDZ in parallel whenever Present opens or the Scene changes. A stale build is dropped.
  useEffect(() => {
    if (scene === null || !hasPlan) {
      setFiles(null);
      return undefined;
    }
    let cancelled = false;
    setBuilding(true);
    setHosting(true);
    setArError(false);
    // Loaded on demand: three's exporters are heavy and only needed here.
    void import("../ar/buildMaquetteFiles")
      .then(({ buildMaquetteFiles }) => buildMaquetteFiles(scene, 1 / scaleDenominator))
      .then(async (built) => {
        if (cancelled) return;
        setFiles(built);
        setHosted({ glb: null, usdz: null });
        // Scene Viewer and Quick Look are separate apps and cannot read blob: URLs: host the files over https.
        // If the upload fails the blob URLs still drive the in-page 3D view.
        const [glb, usdz] = await Promise.allSettled([uploadArModel(built.glb, "glb"), uploadArModel(built.usdz, "usdz")]);
        if (!cancelled) {
          setHosted({
            glb: glb.status === "fulfilled" ? glb.value : null,
            usdz: usdz.status === "fulfilled" ? usdz.value : null,
          });
          if (glb.status === "rejected") console.info("[ar-host] GLB upload failed", glb.reason);
          else console.info("[ar-host] GLB hosted at", glb.value);
        }
      })
      .catch(() => {
        if (!cancelled) setArError(true);
      })
      .finally(() => {
        if (!cancelled) {
          setBuilding(false);
          setHosting(false);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [scene, hasPlan, scaleDenominator]);

  function openAr(): void {
    void viewerRef.current?.activateAR();
  }

  async function shareLink(): Promise<void> {
    const url = window.location.href;
    try {
      await (copyLink ? copyLink(url) : navigator.clipboard.writeText(url));
      setShare("copied");
    } catch {
      setShare("failed");
    }
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-y-auto bg-background font-sans" data-testid="present-view">
      <div className="space-y-3 p-3">
        <h1 className="text-2xl font-extrabold">{t["present.title"]}</h1>
        {arError && <Banner tone="danger" title={t["present.ar.error"]} />}
        {hasPlan && <ScaleSelector value={scaleDenominator} onChange={setScaleDenominator} locale={locale} />}
        {hasPlan && (
          <MaquetteViewer src={hosted.glb ?? glbUrl} iosSrc={hosted.usdz ?? usdzUrl} locale={locale} elementRef={viewerRef} scaleDenominator={scaleDenominator} hostedReady={hosted.glb !== null} />
        )}
        {hasPlan ? (
          <div className="h-[40dvh] min-h-48 overflow-hidden rounded-2xl border-2 border-foreground bg-card">
            <SceneView scene={scene} selectedWallId={selectedWallId} onSelectWall={onSelectWall} />
          </div>
        ) : (
          <Banner tone="info" title={t["present.empty"]} />
        )}

        <ConnectedVariantTabs onSceneChange={onSceneChange} locale={locale} />

        {share === "copied" && <Banner tone="success" title={t["present.shared"]} />}
        {share === "failed" && <Banner tone="warning" title={t["present.shareFailed"]} />}
      </div>

      <div className="sticky bottom-0 mt-auto space-y-2 border-t-2 border-foreground bg-card p-3">
        {hasPlan && !building && !hosting && hosted.glb === null && glbUrl !== null && (
          <p className="text-center text-sm text-muted-foreground" role="status">{getArStrings(locale)["viewer.hostedFailed"]}</p>
        )}
        <Button className="w-full" disabled={!hasPlan || building || hosting || glbUrl === null} onClick={openAr}>
          <Box className="size-6" aria-hidden />
          {building ? t["present.ar.building"] : hosting ? getArStrings(locale)["viewer.hostedPending"] : t["present.ar"]}
        </Button>
        <Button variant="secondary" className="w-full" onClick={() => void shareLink()}>
          <Share2 className="size-6" aria-hidden />
          {t["present.share"]}
        </Button>
        <p className="text-center text-sm text-muted-foreground">{t["notice.preliminary"]}</p>
      </div>
    </div>
  );
}
