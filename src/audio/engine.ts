import type { Clip, Master } from "../types";
import { getBuffer } from "./files";

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

    // clips -> clipGain -> bass -> mid -> treble [-> enhance chain] -> speakers
    const bass = new BiquadFilterNode(ctx, { type: "lowshelf", frequency: 100 });
    const mid = new BiquadFilterNode(ctx, { type: "peaking", frequency: 1000, Q: 1 });
    const treble = new BiquadFilterNode(ctx, { type: "highshelf", frequency: 3000 });
    bass.connect(mid);
    mid.connect(treble);
    let tail: AudioNode = treble;
    if (master.enhance) {
      const highpass = new BiquadFilterNode(ctx, { type: "highpass", frequency: 60 });
      const presence = new BiquadFilterNode(ctx, { type: "peaking", frequency: 3200, Q: 1, gain: 2 });
      const comp = new DynamicsCompressorNode(ctx, {
        threshold: -24, knee: 12, ratio: 3, attack: 0.02, release: 0.25,
      });
      tail.connect(highpass);
      highpass.connect(presence);
      presence.connect(comp);
      tail = comp;
    }
    tail.connect(ctx.destination);
    this.eq = { bass, mid, treble };
    this.setMaster(master);

    const now = ctx.currentTime + 0.05; // scheduling headroom
    for (const clip of clips) {
      const buffer = getBuffer(clip.fileId);
      if (!buffer) continue;
      const endT = clip.offset + (clip.end - clip.start) / clip.speed;
      if (T >= endT) continue;
      const src = new AudioBufferSourceNode(ctx, { buffer, playbackRate: clip.speed });
      const gain = new GainNode(ctx, { gain: clip.muted ? 0 : clip.gain });
      src.connect(gain);
      gain.connect(bass);
      const when = now + Math.max(0, clip.offset - T);
      const sourceOffset = clip.start + Math.max(0, T - clip.offset) * clip.speed;
      src.start(when, sourceOffset, clip.end - sourceOffset);
      this.active.push(src);
      this.clipGains.set(clip.id, gain);
    }
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
