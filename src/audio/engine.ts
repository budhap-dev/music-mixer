import type { Clip, Master } from "../types";
import { buildMixGraph } from "./graph";

/**
 * Live-preview engine: builds a Web Audio graph for the whole arrangement and
 * plays it from a transport position. Per-clip gain and master EQ are updated
 * in place; structural edits (cuts, moves, speed, enhance) rebuild the graph.
 *
 * Milestone-4 note: speed uses playbackRate, which shifts pitch in preview;
 * clip pitch is not yet audible. The SoundTouch worklet will fix both.
 */
export class Engine {
  private ctx: AudioContext | null = null;
  private active: AudioBufferSourceNode[] = [];
  private clipGains = new Map<number, GainNode>();
  private eq: { bass: BiquadFilterNode; mid: BiquadFilterNode; treble: BiquadFilterNode } | null = null;
  private startedAt = 0;
  private startPos = 0;
  private _playing = false;

  get playing(): boolean {
    return this._playing;
  }

  position(): number {
    return this._playing && this.ctx ? this.startPos + (this.ctx.currentTime - this.startedAt) : this.startPos;
  }

  /** Move the transport while stopped (while playing, call play() with `from`). */
  setPosition(t: number): void {
    this.startPos = Math.max(0, t);
  }

  play(clips: Clip[], master: Master, from?: number): void {
    const ctx = (this.ctx ??= new AudioContext());
    if (ctx.state === "suspended") void ctx.resume();
    this.teardown();
    const T = Math.max(0, from ?? this.startPos);

    const now = ctx.currentTime + 0.05; // scheduling headroom
    const graph = buildMixGraph(ctx, clips, master, T, now);
    this.active = graph.sources;
    this.clipGains = graph.clipGains;
    this.eq = graph.eq;
    this.startPos = T;
    this.startedAt = now;
    this._playing = true;
  }

  pause(): void {
    if (this._playing) this.startPos = this.position();
    this.teardown();
    this._playing = false;
  }

  stop(): void {
    this.pause();
    this.startPos = 0;
  }

  setClipGain(id: number, value: number): void {
    const gain = this.clipGains.get(id);
    if (gain && this.ctx) gain.gain.setTargetAtTime(value, this.ctx.currentTime, 0.02);
  }

  setMaster(master: Master): void {
    if (!this.eq || !this.ctx) return;
    const t = this.ctx.currentTime;
    this.eq.bass.gain.setTargetAtTime(master.bass, t, 0.02);
    this.eq.mid.gain.setTargetAtTime(master.mid, t, 0.02);
    this.eq.treble.gain.setTargetAtTime(master.treble, t, 0.02);
  }

  private teardown(): void {
    for (const src of this.active) {
      try { src.stop(); } catch { /* not started yet */ }
      src.disconnect();
    }
    this.active = [];
    this.clipGains.clear();
    this.eq = null;
  }
}
