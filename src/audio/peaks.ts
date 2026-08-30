import { getBuffer } from "./files";

/**
 * Per-file waveform peaks for drawing: max |sample| per bucket at a fixed
 * resolution, computed once per file and cached. ~50 buckets/second keeps a
 * five-minute song around 15k floats.
 */
export const PEAKS_PER_SECOND = 50;

const cache = new Map<string, Float32Array>();

export function getPeaks(fileId: string): Float32Array | null {
  const hit = cache.get(fileId);
  if (hit) return hit;
  const buf = getBuffer(fileId);
  if (!buf) return null;
  const n = Math.ceil(buf.duration * PEAKS_PER_SECOND);
  const peaks = new Float32Array(n);
  const per = buf.sampleRate / PEAKS_PER_SECOND;
  for (let ch = 0; ch < buf.numberOfChannels; ch++) {
    const d = buf.getChannelData(ch);
    for (let b = 0; b < n; b++) {
      const s = Math.floor(b * per), e = Math.min(d.length, Math.floor((b + 1) * per));
      let m = peaks[b];
      for (let i = s; i < e; i += 4) { // stride 4: plenty for display peaks
        const v = Math.abs(d[i]);
        if (v > m) m = v;
      }
      peaks[b] = m;
    }
  }
  cache.set(fileId, peaks);
  return peaks;
}
