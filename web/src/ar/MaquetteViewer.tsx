import { useEffect, useRef, useState } from "react";
import type { Locale } from "../i18n";
import "./ar.css";
import { getArStrings } from "./ar.i18n";
import type { ModelViewerElement } from "./model-viewer.d";
import { loadModelViewer } from "./modelViewerLoader";

import { arModesFor, initialAttempt, likelyUntrustedHost, nextAttempt } from "./arStatus";

const DEFAULT_AR_MODES = "webxr scene-viewer quick-look";

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
  /** ar-modes attribute; defaults to every mode. */
  arModes?: string;
  /** The last AR launch ended without showing the model. */
  attemptFailed?: boolean;
  onRetryWebXr?: () => void;
  /** The page origin looks like a self-signed / non-https dev host. */
  untrustedHost?: boolean;
}

/** Presentational part of the viewer: everything it shows is decided by its props. */
export function ViewerBody({ phase, src, iosSrc, canActivateAR, locale, modelRef, scaleDenominator, arModes = DEFAULT_AR_MODES, attemptFailed = false, onRetryWebXr, untrustedHost = false }: ViewerBodyProps): React.JSX.Element {
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
          ar-modes={arModes}
          ar-placement="floor"
          ar-scale="fixed"
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
      {attemptFailed ? (
        <div className="ar-fallback" role="alert">
          <p>{t["viewer.arFailed"]}</p>
          {untrustedHost ? <p>{t["viewer.hostHint"]}</p> : null}
          {onRetryWebXr ? (
            <button type="button" className="ar-button ar-retry" onClick={onRetryWebXr}>
              {t["viewer.retryWebXr"]}
            </button>
          ) : null}
        </div>
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
  /** True once the GLB is hosted at an absolute https URL that Scene Viewer can fetch. */
  hostedReady?: boolean;
}

/** Table-top AR viewer: registers <model-viewer> lazily and degrades to a 3D-only fallback. */
export function MaquetteViewer({ src, iosSrc, locale, elementRef, scaleDenominator, hostedReady = true }: MaquetteViewerProps): React.JSX.Element {
  const [phase, setPhase] = useState<ViewerPhase>("loading");
  const [canActivateAR, setCanActivateAR] = useState(true);
  const ownRef = useRef<ModelViewerElement | null>(null);
  const modelRef = elementRef ?? ownRef;
  const [attempt, setAttempt] = useState(initialAttempt);
  const [webxrOnly, setWebxrOnly] = useState(false);
  const [retryTick, setRetryTick] = useState(0);

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

  // Log and track every ar-status so a Scene Viewer "not-presenting" is visible, not silent.
  useEffect(() => {
    const element = modelRef.current;
    if (phase !== "ready" || element === null) return undefined;
    const onStatus = (event: Event): void => {
      const status = (event as CustomEvent<{ status?: string }>).detail?.status ?? "";
      console.info("[ar-status]", status, { src });
      setAttempt((prev) => nextAttempt(prev, status));
    };
    element.addEventListener("ar-status", onStatus);
    return () => element.removeEventListener("ar-status", onStatus);
  }, [phase, src]);

  // Retry with WebXR only: wait for the ar-modes attribute to update, then activate.
  useEffect(() => {
    if (retryTick === 0) return undefined;
    const handle = window.setTimeout(() => {
      void modelRef.current?.activateAR();
    }, 0);
    return () => window.clearTimeout(handle);
  }, [retryTick]);

  function retryWithWebXr(): void {
    setWebxrOnly(true);
    setAttempt(initialAttempt());
    setRetryTick((n) => n + 1);
  }

  const origin = typeof window === "undefined" ? "" : window.location.origin;
  return (
    <ViewerBody
      phase={phase}
      src={src}
      iosSrc={iosSrc}
      canActivateAR={canActivateAR}
      locale={locale}
      modelRef={modelRef}
      scaleDenominator={scaleDenominator}
      arModes={arModesFor({ hostedReady, webxrOnly })}
      attemptFailed={attempt.failed}
      onRetryWebXr={webxrOnly ? undefined : retryWithWebXr}
      untrustedHost={likelyUntrustedHost(origin)}
    />
  );
}
