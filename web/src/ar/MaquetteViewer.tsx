import { useEffect, useRef, useState } from "react";
import type { Locale } from "../i18n";
import "./ar.css";
import { getArStrings } from "./ar.i18n";
import type { ModelViewerElement } from "./model-viewer.d";
import { loadModelViewer } from "./modelViewerLoader";

const AR_MODES = "webxr scene-viewer quick-look";

/** "loading": exports or the library are pending. "ready": model-viewer is registered. "failed": it could not load. */
export type ViewerPhase = "loading" | "ready" | "failed";

interface ViewerBodyProps {
  phase: ViewerPhase;
  src: string | null;
  iosSrc: string | null;
  canActivateAR: boolean;
  locale: Locale;
  modelRef?: React.RefObject<ModelViewerElement | null>;
  scaleDenominator?: number;
}

/** Presentational part of the viewer: everything it shows is decided by its props. */
export function ViewerBody({ phase, src, iosSrc, canActivateAR, locale, modelRef, scaleDenominator }: ViewerBodyProps): React.JSX.Element {
  const t = getArStrings(locale);
  const showModel = phase === "ready" && src !== null;
  const showFallback = phase === "failed" || (phase === "ready" && !canActivateAR);

  return (
    <figure className="ar-viewer">
      {phase === "loading" || (phase === "ready" && src === null) ? (
        <div className="ar-fallback" role="status">
          <strong>{t["viewer.loading"]}</strong>
        </div>
      ) : null}
      {showModel ? (
        <model-viewer
          ref={modelRef as React.Ref<HTMLElement>}
          src={src}
          ios-src={iosSrc ?? undefined}
          alt={t["viewer.alt"]}
          ar
          ar-modes={AR_MODES}
          ar-placement="floor"
          camera-controls
          shadow-intensity="1"
        >
          <button slot="ar-button" type="button" className="ar-button">
            {t["viewer.arButton"]}
          </button>
        </model-viewer>
      ) : null}
      {showFallback ? (
        <p className="ar-fallback" role="status">
          {t["viewer.arNotAvailable"]}
        </p>
      ) : null}
      <figcaption className="ar-caption">
        {scaleDenominator === undefined ? null : `${t["viewer.scale"]} 1:${scaleDenominator} · `}
        {t["caption.preliminary"]}
      </figcaption>
    </figure>
  );
}

interface MaquetteViewerProps {
  /** GLB object URL; null while the exports are still building. */
  src: string | null;
  /** USDZ object URL for iOS Quick Look; null while building. */
  iosSrc: string | null;
  locale: Locale;
  /** Lets the parent call `activateAR()` from its own button. */
  elementRef?: React.RefObject<ModelViewerElement | null>;
  scaleDenominator?: number;
}

/** Table-top AR viewer: registers <model-viewer> lazily and degrades to a 3D-only fallback. */
export function MaquetteViewer({ src, iosSrc, locale, elementRef, scaleDenominator }: MaquetteViewerProps): React.JSX.Element {
  const [phase, setPhase] = useState<ViewerPhase>("loading");
  const [canActivateAR, setCanActivateAR] = useState(true);
  const ownRef = useRef<ModelViewerElement | null>(null);
  const modelRef = elementRef ?? ownRef;

  useEffect(() => {
    let cancelled = false;
    void loadModelViewer().then((ok) => {
      if (!cancelled) setPhase(ok ? "ready" : "failed");
    });
    return () => {
      cancelled = true;
    };
  }, []);

  // `canActivateAR` is only meaningful once the model has loaded.
  useEffect(() => {
    const element = modelRef.current;
    if (phase !== "ready" || element === null) return undefined;
    const onLoad = (): void => setCanActivateAR(element.canActivateAR);
    element.addEventListener("load", onLoad);
    return () => element.removeEventListener("load", onLoad);
  }, [phase, src]);

  return <ViewerBody phase={phase} src={src} iosSrc={iosSrc} canActivateAR={canActivateAR} locale={locale} modelRef={modelRef} scaleDenominator={scaleDenominator} />;
}
