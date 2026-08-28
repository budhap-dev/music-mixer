import type { Clip, Master } from "../types";
import type { EncodeMessage, EncodeRequest } from "./mp3.worker";
import { buildMixGraph } from "./graph";
import { mixLength } from "../utils/time";

const SAMPLE_RATE = 44100;
const KBPS = 320;

/** Renders the arrangement through the same graph the preview uses. */
async function renderMix(clips: Clip[], master: Master): Promise<AudioBuffer> {
  const length = mixLength(clips);
  const ctx = new OfflineAudioContext(2, Math.ceil(length * SAMPLE_RATE), SAMPLE_RATE);
  buildMixGraph(ctx, clips, master, 0, 0);
  return ctx.startRendering();
}

function encodeMp3(rendered: AudioBuffer, onProgress: (v: number) => void): Promise<Blob> {
  const worker = new Worker(new URL("./mp3.worker.ts", import.meta.url), { type: "module" });
  return new Promise<Blob>((resolve, reject) => {
    worker.onmessage = (e: MessageEvent<EncodeMessage>) => {
      if (e.data.type === "progress") onProgress(e.data.value);
      else resolve(e.data.blob);
    };
    worker.onerror = () => reject(new Error("MP3 encoding failed"));
    // slice(): the worker takes copies, leaving the AudioBuffer intact
    const left = rendered.getChannelData(0).slice();
    const right = rendered.numberOfChannels > 1 ? rendered.getChannelData(1).slice() : left.slice();
    const request: EncodeRequest = { sampleRate: rendered.sampleRate, left, right, kbps: KBPS };
    worker.postMessage(request, [left.buffer, right.buffer]);
  }).finally(() => worker.terminate());
}

/**
 * Renders the mix offline, encodes it to MP3 in a worker and triggers a
 * download. `onProgress` reports encode progress in 0–1.
 */
export async function exportMp3(
  clips: Clip[],
  master: Master,
  title: string,
  onProgress: (v: number) => void,
): Promise<void> {
  const rendered = await renderMix(clips, master);
  const blob = await encodeMp3(rendered, onProgress);
  const name = (title.trim() || "mix").replace(/[/\\:*?"<>|]/g, "_");
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `${name}.mp3`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  // revoking synchronously can cancel the download before it starts
  setTimeout(() => URL.revokeObjectURL(url), 30_000);
}
