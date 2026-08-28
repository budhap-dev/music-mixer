import type { Clip } from "../types";
import { getBuffer } from "./files";
import type { StretchRequest, StretchResponse } from "./stretch.worker";

/**
 * Formant-preserving speed/pitch rendering. Whole source files are processed
 * in a worker (Rubber Band WASM) and cached per (file, speed, pitch); the
 * graph then plays them at playbackRate 1, so cut edits need no reprocessing —
 * source time t simply maps to t/speed in the processed buffer.
 */

const done = new Map<string, AudioBuffer>();
const pending = new Map<string, Promise<AudioBuffer>>();
const MAX_CACHED = 12;

let worker: Worker | null = null;
let nextId = 1;
const waiters = new Map<number, {
  resolve: (chs: Float32Array<ArrayBuffer>[]) => void;
  reject: (e: Error) => void;
  onProgress?: (v: number) => void;
}>();

const keyOf = (c: Clip) => `${c.fileId}|${c.speed}|${c.pitch}`;

export const needsProcessing = (c: Clip) => c.speed !== 1 || c.pitch !== 0;

/** The processed buffer if it's ready; undefined while still rendering. */
export const getProcessed = (c: Clip) => done.get(keyOf(c));

function workerInstance(): Worker {
  if (!worker) {
    worker = new Worker(new URL("./stretch.worker.ts", import.meta.url), { type: "module" });
    worker.onmessage = (e: MessageEvent<StretchResponse>) => {
      const w = waiters.get(e.data.id);
      if (!w) return;
      if ("progress" in e.data) {
        w.onProgress?.(e.data.progress);
        return;
      }
      waiters.delete(e.data.id);
      if ("error" in e.data) w.reject(new Error(e.data.error));
      else w.resolve(e.data.channels);
    };
  }
  return worker;
}

function processClip(clip: Clip, onProgress?: (v: number) => void): Promise<AudioBuffer> {
  const key = keyOf(clip);
  const ready = done.get(key);
  if (ready) return Promise.resolve(ready);
  const inflight = pending.get(key);
  if (inflight) return inflight;
  const source = getBuffer(clip.fileId);
  if (!source) return Promise.reject(new Error("source audio missing"));
  const channels: Float32Array<ArrayBuffer>[] = [];
  for (let i = 0; i < source.numberOfChannels; i++) channels.push(source.getChannelData(i).slice());
  const id = nextId++;
  const p = new Promise<Float32Array<ArrayBuffer>[]>((resolve, reject) => {
    waiters.set(id, { resolve, reject, onProgress });
    const request: StretchRequest = {
      id,
      sampleRate: source.sampleRate,
      channels,
      timeRatio: 1 / clip.speed,
      pitchScale: Math.pow(2, clip.pitch / 12),
    };
    workerInstance().postMessage(request, channels.map((a) => a.buffer));
  }).then((chs) => {
    const buffer = new AudioBuffer({
      numberOfChannels: chs.length,
      length: chs[0].length,
      sampleRate: source.sampleRate,
    });
    chs.forEach((a, i) => buffer.copyToChannel(a, i));
    pending.delete(key);
    done.set(key, buffer);
    for (const k of done.keys()) {
      if (done.size <= MAX_CACHED) break;
      done.delete(k); // drop oldest settings first
    }
    return buffer;
  });
  pending.set(key, p);
  return p;
}

/**
 * Start rendering every clip that needs it; resolves when all are ready.
 * onProgress reports overall progress in 0–1 (the worker runs jobs serially).
 */
export function ensureProcessed(clips: Clip[], onProgress?: (v: number) => void): Promise<void> {
  const todo = clips.filter(needsProcessing);
  const fractions = new Array<number>(todo.length).fill(0);
  const report = onProgress
    ? (i: number) => (v: number) => {
        fractions[i] = v;
        onProgress(fractions.reduce((s, f) => s + f, 0) / todo.length);
      }
    : () => undefined;
  return Promise.all(todo.map((c, i) => processClip(c, report(i)))).then(() => undefined);
}
