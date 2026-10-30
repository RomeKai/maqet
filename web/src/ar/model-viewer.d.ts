import type { DetailedHTMLProps, HTMLAttributes } from "react";

/** Attributes of <model-viewer> that Maqet uses. Nothing else is typed on purpose. */
interface ModelViewerAttributes extends DetailedHTMLProps<HTMLAttributes<HTMLElement>, HTMLElement> {
  src?: string;
  "ios-src"?: string;
  alt?: string;
  ar?: boolean;
  "ar-modes"?: string;
  "ar-placement"?: "floor" | "wall";
  "camera-controls"?: boolean;
  "shadow-intensity"?: string;
}

declare module "react" {
  namespace JSX {
    interface IntrinsicElements {
      "model-viewer": ModelViewerAttributes;
    }
  }
}

/** The part of the element API we read after load. */
export interface ModelViewerElement extends HTMLElement {
  canActivateAR: boolean;
}
