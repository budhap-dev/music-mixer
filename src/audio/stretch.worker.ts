import initRubberband, { type RubberbandModule } from "@echogarden/rubberband-wasm";
import wasmUrl from "@echogarden/rubberband-wasm/rubberband.wasm?url";

/**
 * Offline time-stretch / pitch-shift via Rubber Band (WASM), off the main
 * thread. Formants are preserved so shifted vocals keep their natural timbre
 * instead of going chipmunk/giant.
 */

export interface StretchRequest {
  id: number;
  sampleRate: number;
  channels: Float32Array<ArrayBuffer>[];
  timeRatio: number; // output length ÷ input length (1/speed)
  pitchScale: number; // frequency multiplier (2^(semitones/12))
}

export type StretchResponse =
  | { id: number; channels: Float32Array<ArrayBuffer>[] }
  | { id: number; progress: number } // 0–1, while processing
  | { id: number; error: string };

// OptionProcessOffline | OptionEngineFiner (R3 — far more natural on voices
// than R2) | OptionFormantPreserved | OptionChannelsTogether (keeps stereo
// phase-coherent) | OptionThreadingNever (single-threaded WASM)
const OPTIONS = 0x00000000 | 0x20000000 | 0x01000000 | 0x10000000 | 0x00010000;
const CHUNK = 8192;

let modPromise: Promise<RubberbandModule> | null = null;
const mod = () => (modPromise ??= initRubberband({ locateFile: () => wasmUrl }));

self.onmessage = async (e: MessageEvent<StretchRequest>) => {
  const { id, sampleRate, channels, timeRatio, pitchScale } = e.data;
  try {
    const M = await mod();
    const n = channels.length;
    const len = channels[0].length;
    const state = M._rubberband_new(sampleRate, n, OPTIONS, timeRatio, pitchScale);
    M._rubberband_set_expected_input_duration(state, len);
    M._rubberband_set_max_process_size(state, CHUNK);
    const bufPtrs = channels.map(() => M._malloc(CHUNK * 4));
    const ptrArr = M._malloc(n * 4);
    // heap views must be re-derived after any allocation (memory can grow)
    const setPtrs = () => {
      const u32 = new Uint32Array(M.HEAPF32.buffer, ptrArr, n);
      for (let c = 0; c < n; c++) u32[c] = bufPtrs[c];
    };

    const feed = (fn: (ptrs: number, count: number, final: number) => void) => {
      for (let i = 0; i < len; i += CHUNK) {
        const count = Math.min(CHUNK, len - i);
        for (let c = 0; c < n; c++)
          new Float32Array(M.HEAPF32.buffer, bufPtrs[c], count).set(channels[c].subarray(i, i + count));
        setPtrs();
        fn(ptrArr, count, i + CHUNK >= len ? 1 : 0);
      }
    };

    const out: Float32Array[][] = channels.map(() => []);
    const drain = () => {
      let avail: number;
      while ((avail = M._rubberband_available(state)) > 0) {
        setPtrs();
        const got = M._rubberband_retrieve(state, ptrArr, Math.min(avail, CHUNK));
        if (got <= 0) break;
        for (let c = 0; c < n; c++)
          out[c].push(new Float32Array(M.HEAPF32.buffer, bufPtrs[c], got).slice());
      }
    };

    feed((p, c, f) => M._rubberband_study(state, p, c, f)); // offline mode: full first pass
    let fed = 0;
    feed((p, c, f) => {
      M._rubberband_process(state, p, c, f);
      drain();
      fed += c;
      if (fed % (CHUNK * 8) === 0 || f)
        (self as unknown as Worker).postMessage({ id, progress: fed / len } satisfies StretchResponse);
    });
    drain();
    M._rubberband_delete(state);
    for (const p of bufPtrs) M._free(p);
    M._free(ptrArr);

    const merged = out.map((parts) => {
      const arr = new Float32Array(parts.reduce((s, a) => s + a.length, 0));
      let o = 0;
      for (const a of parts) {
        arr.set(a, o);
        o += a.length;
      }
      return arr;
    });
    (self as unknown as Worker).postMessage(
      { id, channels: merged } satisfies StretchResponse,
      merged.map((a) => a.buffer),
    );
  } catch (err) {
    (self as unknown as Worker).postMessage({ id, error: String(err) } satisfies StretchResponse);
  }
};
