/**
 * Intake image helpers (web, P0 phone-first).
 * Client-side downscale (longest side ≤ 2048 px) + EXIF orientation fix,
 * plus the px->m scale math that mirrors server/intake/cleanup.py:
 * px->m = typed / pixel_len. Comma and point decimals both work.
 */

export const MAX_SIDE_PX = 2048;

export interface DownscaledSize {
  width: number;
  height: number;
}

export interface DownscaledImage extends DownscaledSize {
  blob: Blob;
}

/** Pure: target size keeping aspect ratio, longest side capped at `maxSide`. */
export function computeDownscale(
  width: number,
  height: number,
  maxSide: number = MAX_SIDE_PX,
): DownscaledSize {
  const longest = Math.max(width, height);
  if (!Number.isFinite(longest) || longest <= 0) return { width: 0, height: 0 };
  if (longest <= maxSide) return { width: Math.round(width), height: Math.round(height) };
  const ratio = maxSide / longest;
  return { width: Math.max(1, Math.round(width * ratio)), height: Math.max(1, Math.round(height * ratio)) };
}

const DIM_RE = /(\d+(?:[.,]\d+)?)\s*(m(?:etros?)?\b)?\s*(total\b)?/i;

/**
 * Parse a typed or transcribed measurement ("3,50", "2.80 m", "6,00 total").
 * Returns null when no number is found. Mirrors parse_dimension_meters.
 */
export function parseDimensionMeters(text: string): number | null {
  if (!text || !text.trim()) return null;
  const match = DIM_RE.exec(text.trim().replace(/_/g, " "));
  if (match === null || match[1] === undefined) return null;
  const value = Number(match[1].replace(",", "."));
  return Number.isFinite(value) ? value : null;
}

/**
 * px->m scale factor: typed real length divided by its length in image pixels.
 * Returns null when the pixel length is not usable.
 */
export function metersPerPixel(typedMeters: number, pixelLength: number): number | null {
  if (!Number.isFinite(typedMeters) || !Number.isFinite(pixelLength)) return null;
  if (pixelLength <= 0 || typedMeters <= 0) return null;
  return typedMeters / pixelLength;
}

/**
 * Downscale an uploaded plan/sketch photo to ≤ 2048 px on the longest side
 * and fix EXIF rotation. createImageBitmap with imageOrientation handles
 * EXIF; falls back to an <img> element when unavailable.
 */
export async function downscaleImage(
  file: Blob,
  maxSide: number = MAX_SIDE_PX,
): Promise<DownscaledImage> {
  let bitmap: ImageBitmap | HTMLImageElement;
  let bitmapWidth: number;
  let bitmapHeight: number;

  if (typeof createImageBitmap === "function") {
    try {
      const bmp = await createImageBitmap(file, { imageOrientation: "from-image" });
      bitmap = bmp;
      bitmapWidth = bmp.width;
      bitmapHeight = bmp.height;
    } catch {
      bitmap = await loadViaElement(file);
      bitmapWidth = bitmap.naturalWidth;
      bitmapHeight = bitmap.naturalHeight;
    }
  } else {
    bitmap = await loadViaElement(file);
    bitmapWidth = bitmap.naturalWidth;
    bitmapHeight = bitmap.naturalHeight;
  }

  const { width, height } = computeDownscale(bitmapWidth, bitmapHeight, maxSide);
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  if (ctx === null) throw new Error("Canvas 2D no disponible");
  ctx.drawImage(bitmap, 0, 0, width, height);
  if ("close" in bitmap) bitmap.close();

  const blob = await new Promise<Blob | null>((resolve) =>
    canvas.toBlob((b) => resolve(b), "image/jpeg", 0.85),
  );
  if (blob === null) throw new Error("No se pudo procesar la imagen");
  return { blob, width, height };
}

function loadViaElement(file: Blob): Promise<HTMLImageElement> {
  const url = URL.createObjectURL(file);
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      resolve(img);
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("No se pudo leer la imagen"));
    };
    img.src = url;
  });
}
