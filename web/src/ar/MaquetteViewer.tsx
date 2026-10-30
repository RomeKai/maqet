import { useEffect, useState } from "react";
import type { Locale } from "../i18n";
import "./ar.css";
import { getArStrings } from "./ar.i18n";

const AR_MODES = "webxr scene-viewer quick-look";

/** True when the <model-viewer> custom element has been registered in this page. */
export function isModelViewerRegistered(): boolean {
  return typeof customElements !== "undefined" && customElements.get("model-viewer") !== undefined;
}

interface MaquetteViewerProps {
  /** URL of the GLB (typically a blob URL from exportGlb). */
  src: string;
  /** Optional pre-baked USDZ for iOS Quick Look. */
  iosSrc?: string;
  locale: Locale;
}

/** Table-top AR viewer: <model-viewer> when registered, otherwise a clear "AR viewer unavailable" fallback. */
export function MaquetteViewer({ src, iosSrc, locale }: MaquetteViewerProps): React.JSX.Element {
  const t = getArStrings(locale);
  const [available, setAvailable] = useState(isModelViewerRegistered);

  // The script may register the element after first render; switch over when it does.
  useEffect(() => {
    if (available || typeof customElements === "undefined") return;
    let cancelled = false;
    void customElements.whenDefined("model-viewer").then(() => {
      if (!cancelled) setAvailable(true);
    });
    return () => {
      cancelled = true;
    };
  }, [available]);

  return (
    <figure className="ar-viewer">
      {available ? (
        <model-viewer
          src={src}
          ios-src={iosSrc}
          alt={t["viewer.alt"]}
          ar
          ar-modes={AR_MODES}
          camera-controls
          shadow-intensity="1"
        />
      ) : (
        <div className="ar-fallback" role="status">
          <strong>{t["viewer.unavailable"]}</strong>
          <p>{t["viewer.unavailableHint"]}</p>
        </div>
      )}
      <figcaption className="ar-caption">{t["caption.preliminary"]}</figcaption>
    </figure>
  );
}
