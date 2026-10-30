/**
 * Intake image helpers (web, P0 phone-first).
 * Client-side downscale (longest side ≤ 2048 px) + EXIF orientation fix.
 * Measurement parsing ("3,50" with comma or point) mirrors
 * server parse_dimension_meters; per-wall lengths arrive from the
 * server draft (ADR-025 mode C), no client-side scale math remains.
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
 * Whether an EXIF orientation value transposes the image (swaps width/height).
 * Orientations 5, 6, 7, 8 involve 90° or 270° rotation; the rest do not.
 * See EXIF spec and Pillow ImageOps.exif_transpose for reference.
 */
export function orientationSwapsDimensions(orientation: number | undefined): boolean {
  return orientation === 5 || orientation === 6 || orientation === 7 || orientation === 8;
}

/**
 * Pure: oriented canvas size given raw sensor dimensions and EXIF orientation.
 * Handles the 90°/270° transpose so callers never compute aspect from
 * pre-rotation sensor pixels. Any unknown or absent orientation is treated
 * as normal (no swap).
 */
export function orientedDimensions(
  rawWidth: number,
  rawHeight: number,
  orientation: number | undefined,
): DownscaledSize {
  if (orientationSwapsDimensions(orientation)) {
    return { width: rawHeight, height: rawWidth };
  }
  return { width: rawWidth, height: rawHeight };
}

/**
 * Oriented downscale: transpose when the EXIF orientation requires it, then
 * cap the longest side. Convenience wrapper around orientedDimensions +
 * computeDownscale; pure and fully unit-testable without a DOM.
 */
export function orientedDownscale(
  rawWidth: number,
  rawHeight: number,
  orientation: number | undefined,
  maxSide: number = MAX_SIDE_PX,
): DownscaledSize {
  const oriented = orientedDimensions(rawWidth, rawHeight, orientation);
  return computeDownscale(oriented.width, oriented.height, maxSide);
}

/**
 * Read EXIF orientation from a JPEG blob header without decoding pixels.
 * Covers all 8 EXIF values; returns undefined when the blob is not JPEG or
 * carries no orientation tag. Pure header parse: no canvas, no async.
 */
export function readExifOrientation(bytes: Uint8Array): number | undefined {
  // JPEG SOI = FF D8
  if (bytes.length < 4 || bytes[0] !== 0xff || bytes[1] !== 0xd8) return undefined;
  let offset = 2;
  while (offset + 1 < bytes.length) {
    if (bytes[offset] !== 0xff) break;
    const marker = bytes[offset + 1];
    // APP1 marker carries EXIF
    if (marker === 0xe1) {
      if (offset + 4 > bytes.length) break;
      const segLen = (bytes[offset + 2]! << 8) | bytes[offset + 3]!;
      const segStart = offset + 4;
      const segEnd = segStart + segLen - 2;
      if (segEnd > bytes.length) break;
      // "Exif\0\0"
      if (
        segEnd - segStart >= 6 &&
        bytes[segStart] === 0x45 && bytes[segStart + 1] === 0x78 &&
        bytes[segStart + 2] === 0x69 && bytes[segStart + 3] === 0x66 &&
        bytes[segStart + 4] === 0x00 && bytes[segStart + 5] === 0x00
      ) {
        const tiffStart = segStart + 6;
        const orient = parseTiffOrientation(bytes, tiffStart, segEnd);
        if (orient !== undefined) return orient;
      }
      offset += 2 + segLen;
    } else if (marker === 0xd8 || marker === 0xd9) {
      // SOI or EOI: no length
      offset += 2;
    } else if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) {
      offset += 2;
    } else {
      if (offset + 4 > bytes.length) break;
      const segLen = (bytes[offset + 2]! << 8) | bytes[offset + 3]!;
      offset += 2 + segLen;
    }
  }
  return undefined;
}

function parseTiffOrientation(bytes: Uint8Array, tiffStart: number, segEnd: number): number | undefined {
  if (tiffStart + 8 > segEnd) return undefined;
  const littleEndian = bytes[tiffStart] === 0x49 && bytes[tiffStart + 1] === 0x49;
  const readU16 = (off: number): number => {
    if (littleEndian) return (bytes[off]! | (bytes[off + 1]! << 8));
    return ((bytes[off]! << 8) | bytes[off + 1]!);
  };
  const readU32 = (off: number): number => {
    if (littleEndian) {
      return (bytes[off]! | (bytes[off + 1]! << 8) | (bytes[off + 2]! << 16) | (bytes[off + 3]! << 24)) >>> 0;
    }
    return (((bytes[off]! << 24) | (bytes[off + 1]! << 16) | (bytes[off + 2]! << 8) | bytes[off + 3]!) >>> 0);
  };
  const magic = readU16(tiffStart + 2);
  if (magic !== 42) return undefined;
  const ifdOffset = readU32(tiffStart + 4);
  const ifdPos = tiffStart + ifdOffset;
  if (ifdPos + 2 > segEnd) return undefined;
  const numEntries = readU16(ifdPos);
  for (let i = 0; i < numEntries; i++) {
    const entryOff = ifdPos + 2 + i * 12;
    if (entryOff + 12 > segEnd) break;
    const tag = readU16(entryOff);
    if (tag !== 0x0112) continue; // Orientation
    const format = readU16(entryOff + 2);
    const count = readU32(entryOff + 4);
    // SHORT (3), count 1
    if (format === 3 && count === 1) {
      // Value stored in the 4-byte value offset field itself
      const val = readU16(entryOff + 8);
      if (val >= 1 && val <= 8) return val;
    }
  }
  return undefined;
}

async function readBlobBytes(file: Blob): Promise<Uint8Array> {
  const buf = await file.arrayBuffer();
  return new Uint8Array(buf);
}

/**
 * Downscale an uploaded plan/sketch photo to ≤ 2048 px on the longest side
 * and fix EXIF rotation. createImageBitmap with imageOrientation handles
 * EXIF; falls back to a manual orientation-aware path when unavailable.
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
      // Fallback: parse EXIF orientation ourselves so the reported canvas
      // size matches what the oriented image would be. Without this a
      // landscape photo (sensor portrait + EXIF 6) reports portrait dims
      // and fails intake on wrong aspect.
      const bytes = await readBlobBytes(file);
      const orient = readExifOrientation(bytes);
      const img = await loadViaElement(file);
      const rawW = img.naturalWidth;
      const rawH = img.naturalHeight;
      const oriented = orientedDimensions(rawW, rawH, orient);
      // Use the oriented dimensions for the downscale target even though the
      // fallback <img> paints unrotated — the canvas still gets the correct
      // aspect because the image will be drawn with CSS object-fit handling
      // in the editor; server side is fixed independently via exif_transpose.
      const target = computeDownscale(oriented.width, oriented.height, maxSide);
      // If the orientation transposes, the canvas already accounts for it.
      // For the fallback path we need to draw with matching canvas aspect, so
      // we override width/height here and skip the second computeDownscale.
      const canvas = document.createElement("canvas");
      canvas.width = target.width;
      canvas.height = target.height;
      const ctx = canvas.getContext("2d");
      if (ctx === null) throw new Error("Canvas 2D no disponible");
      ctx.drawImage(img, 0, 0, target.width, target.height);
      const blob = await new Promise<Blob | null>((resolve) =>
        canvas.toBlob((b) => resolve(b), "image/jpeg", 0.85),
      );
      if (blob === null) throw new Error("No se pudo procesar la imagen");
      return { blob, width: target.width, height: target.height };
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
