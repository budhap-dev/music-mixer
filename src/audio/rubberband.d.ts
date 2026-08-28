declare module "@echogarden/rubberband-wasm" {
  /** Emscripten module: raw Rubber Band C API plus malloc/heap access. */
  export interface RubberbandModule {
    _malloc(bytes: number): number;
    _free(ptr: number): void;
    HEAPF32: Float32Array;
    _rubberband_new(
      sampleRate: number, channels: number, options: number,
      timeRatio: number, pitchScale: number,
    ): number;
    _rubberband_delete(state: number): void;
    _rubberband_set_expected_input_duration(state: number, samples: number): void;
    _rubberband_set_max_process_size(state: number, samples: number): void;
    _rubberband_study(state: number, channelPtrs: number, samples: number, final: number): void;
    _rubberband_process(state: number, channelPtrs: number, samples: number, final: number): void;
    _rubberband_available(state: number): number;
    _rubberband_retrieve(state: number, channelPtrs: number, samples: number): number;
  }
  const init: (opts?: { locateFile?: (path: string) => string }) => Promise<RubberbandModule>;
  export default init;
}

declare module "@echogarden/rubberband-wasm/rubberband.wasm?url" {
  const url: string;
  export default url;
}
