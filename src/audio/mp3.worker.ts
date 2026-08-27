import { Mp3Encoder } from "@breezystack/lamejs";

/** Encodes stereo PCM to MP3 off the main thread so the UI stays responsive. */

export interface EncodeRequest {
  sampleRate: number;
  left: Float32Array;
  right: Float32Array;
  kbps: number;
}

export type EncodeMessage =
  | { type: "progress"; value: number } // 0–1
  | { type: "done"; blob: Blob };

const toInt16 = (samples: Float32Array): Int16Array => {
  const out = new Int16Array(samples.length);
  for (let i = 0; i < samples.length; i++) {
    const s = Math.max(-1, Math.min(1, samples[i]));
    out[i] = s < 0 ? s * 0x8000 : s * 0x7fff;
  }
  return out;
};

self.onmessage = (e: MessageEvent<EncodeRequest>) => {
  const { sampleRate, left, right, kbps } = e.data;
  const encoder = new Mp3Encoder(2, sampleRate, kbps);
  const l = toInt16(left);
  const r = toInt16(right);
  const block = 1152 * 32; // MP3 frame size × 32 ≈ 0.8 s per chunk
  const parts: Uint8Array<ArrayBuffer>[] = [];
  for (let i = 0; i < l.length; i += block) {
    const chunk = encoder.encodeBuffer(l.subarray(i, i + block), r.subarray(i, i + block));
    if (chunk.length) parts.push(new Uint8Array(chunk));
    self.postMessage({ type: "progress", value: i / l.length } satisfies EncodeMessage);
  }
  const tail = encoder.flush();
  if (tail.length) parts.push(new Uint8Array(tail));
  self.postMessage({ type: "done", blob: new Blob(parts, { type: "audio/mpeg" }) } satisfies EncodeMessage);
};
