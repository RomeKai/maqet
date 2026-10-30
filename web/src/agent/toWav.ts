/**
 * MediaRecorder output (webm/ogg/mp4) -> mono PCM16 WAV at 16 kHz, the only
 * format POST /transcribe accepts (mono 16-bit PCM WAV at 16 or 24 kHz).
 */
export const TARGET_RATE = 16000;

/** Number of output frames after resampling `frames` from `fromRate` to TARGET_RATE. */
export function resampledLength(frames: number, fromRate: number, toRate: number = TARGET_RATE): number {
  return Math.max(1, Math.round((frames * toRate) / fromRate));
}

/** Average all channels into one. */
export function downmix(channels: readonly Float32Array[]): Float32Array {
  const first = channels[0];
  if (first === undefined) return new Float32Array(0);
  if (channels.length === 1) return first;
  const out = new Float32Array(first.length);
  for (const ch of channels) for (let i = 0; i < out.length; i++) out[i]! += (ch[i] ?? 0) / channels.length;
  return out;
}

function writeAscii(view: DataView, offset: number, text: string): void {
  for (let i = 0; i < text.length; i++) view.setUint8(offset + i, text.charCodeAt(i));
}

/** PCM16 mono WAV bytes (44-byte RIFF header + little-endian samples). */
export function encodeWavPcm16(samples: Float32Array, sampleRate: number): ArrayBuffer {
  const dataBytes = samples.length * 2;
  const buf = new ArrayBuffer(44 + dataBytes);
  const v = new DataView(buf);
  writeAscii(v, 0, "RIFF");
  v.setUint32(4, 36 + dataBytes, true);
  writeAscii(v, 8, "WAVE");
  writeAscii(v, 12, "fmt ");
  v.setUint32(16, 16, true);
  v.setUint16(20, 1, true); // PCM
  v.setUint16(22, 1, true); // mono
  v.setUint32(24, sampleRate, true);
  v.setUint32(28, sampleRate * 2, true); // byte rate
  v.setUint16(32, 2, true); // block align
  v.setUint16(34, 16, true); // bits per sample
  writeAscii(v, 36, "data");
  v.setUint32(40, dataBytes, true);
  for (let i = 0; i < samples.length; i++) {
    const s = Math.max(-1, Math.min(1, samples[i] ?? 0));
    v.setInt16(44 + i * 2, Math.round(s < 0 ? s * 0x8000 : s * 0x7fff), true);
  }
  return buf;
}

/** Browser-only: decode, downmix, resample to 16 kHz, encode WAV. */
export async function blobToWav(blob: Blob): Promise<Blob> {
  const Ctx = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
  const ctx = new Ctx();
  try {
    const decoded = await ctx.decodeAudioData(await blob.arrayBuffer());
    const channels = Array.from({ length: decoded.numberOfChannels }, (_, i) => decoded.getChannelData(i));
    const mono = downmix(channels);
    const length = resampledLength(mono.length, decoded.sampleRate);
    const offline = new OfflineAudioContext(1, length, TARGET_RATE);
    const src = offline.createBufferSource();
    const monoBuf = offline.createBuffer(1, mono.length, decoded.sampleRate);
    monoBuf.copyToChannel(mono, 0);
    src.buffer = monoBuf;
    src.connect(offline.destination);
    src.start();
    const rendered = await offline.startRendering();
    return new Blob([encodeWavPcm16(rendered.getChannelData(0), TARGET_RATE)], { type: "audio/wav" });
  } finally {
    void ctx.close();
  }
}
