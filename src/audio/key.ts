import { getBuffer } from "./files";
import type { KeyRequest, KeyResponse, KeySegment } from "./key.worker";

export type { KeySegment } from "./key.worker";

const NOTES = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];

/** Human label for a segment, transposed by a clip's pitch shift (semitones). */
export const keyLabel = (seg: KeySegment, semitones = 0): string =>
  `${NOTES[(((seg.tonic + semitones) % 12) + 12) % 12]} ${seg.mode === "major" ? "maj" : "min"}`;

/** The segment sounding at source time t (segments are sorted by start). */
export const segmentAt = (segments: KeySegment[], t: number): KeySegment | undefined => {
  let hit: KeySegment | undefined;
  for (const s of segments) if (s.start <= t) hit = s;
  return hit ?? segments[0];
};

const cache = new Map<string, Promise<KeySegment[]>>();
let worker: Worker | null = null;
let nextId = 1;
const waiters = new Map<number, (segments: KeySegment[]) => void>();

/** Detect the key timeline of a source file (cached per fileId). */
export function detectKey(fileId: string): Promise<KeySegment[]> {
  const hit = cache.get(fileId);
  if (hit) return hit;
  const buffer = getBuffer(fileId);
  if (!buffer) return Promise.reject(new Error("source audio missing"));
  if (!worker) {
    worker = new Worker(new URL("./key.worker.ts", import.meta.url), { type: "module" });
    worker.onmessage = (e: MessageEvent<KeyResponse>) => {
      waiters.get(e.data.id)?.(e.data.segments);
      waiters.delete(e.data.id);
    };
  }
  // mono downmix
  const mono = buffer.getChannelData(0).slice();
  for (let c = 1; c < buffer.numberOfChannels; c++) {
    const d = buffer.getChannelData(c);
    for (let i = 0; i < mono.length; i++) mono[i] += d[i];
  }
  if (buffer.numberOfChannels > 1)
    for (let i = 0; i < mono.length; i++) mono[i] /= buffer.numberOfChannels;
  const id = nextId++;
  const p = new Promise<KeySegment[]>((resolve) => {
    waiters.set(id, resolve);
    const request: KeyRequest = { id, sampleRate: buffer.sampleRate, samples: mono };
    worker!.postMessage(request, [mono.buffer]);
  });
  cache.set(fileId, p);
  return p;
}
