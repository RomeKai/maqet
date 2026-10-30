import { useState } from "react";
import { Box, Share2 } from "lucide-react";
import { getStrings, type Locale } from "../i18n";
import type { Scene } from "../scene/types";
import { SceneView } from "../view3d/SceneView";
import { MaquetteViewer } from "../ar/MaquetteViewer";
import { useMaquetteUrl } from "../ar/useMaquetteUrl";
import { VariantTabs } from "../agent/VariantTabs";
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
  const [glb, setGlb] = useState<ArrayBuffer | null>(null);
  const [building, setBuilding] = useState(false);
  const [arError, setArError] = useState(false);
  const [share, setShare] = useState<ShareState>("idle");
  const maquetteUrl = useMaquetteUrl(glb);
  const hasPlan = scene !== null && (scene.walls?.length ?? 0) > 0;

  async function buildAr(): Promise<void> {
    if (scene === null) return;
    setBuilding(true);
    setArError(false);
    try {
      // Loaded on demand: three's exporters are heavy and only needed here.
      const [{ sceneToMaquette }, { exportGlb }] = await Promise.all([
        import("../ar/sceneToMaquette"),
        import("../ar/exportMaquette"),
      ]);
      setGlb(await exportGlb(sceneToMaquette(scene)));
    } catch {
      setArError(true);
    } finally {
      setBuilding(false);
    }
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
        {hasPlan ? (
          <div className="h-[40dvh] min-h-48 overflow-hidden rounded-2xl border-2 border-foreground bg-card">
            <SceneView scene={scene} selectedWallId={selectedWallId} onSelectWall={onSelectWall} />
          </div>
        ) : (
          <Banner tone="info" title={t["present.empty"]} />
        )}

        <VariantTabs onSceneChange={onSceneChange} locale={locale} />

        {arError && <Banner tone="danger" title={t["present.ar.error"]} />}
        {maquetteUrl !== null && <MaquetteViewer src={maquetteUrl} locale={locale} />}
        {share === "copied" && <Banner tone="success" title={t["present.shared"]} />}
        {share === "failed" && <Banner tone="warning" title={t["present.shareFailed"]} />}
      </div>

      <div className="sticky bottom-0 mt-auto space-y-2 border-t-2 border-foreground bg-card p-3">
        <Button className="w-full" disabled={!hasPlan || building} onClick={() => void buildAr()}>
          <Box className="size-6" aria-hidden />
          {building ? t["present.ar.building"] : t["present.ar"]}
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
