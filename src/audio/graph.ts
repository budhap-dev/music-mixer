import type { Clip, Master } from "../types";
import { getBuffer } from "./files";

export interface MixGraph {
  sources: AudioBufferSourceNode[];
  clipGains: Map<number, GainNode>;
  eq: { bass: BiquadFilterNode; mid: BiquadFilterNode; treble: BiquadFilterNode };
}

/**
 * Builds the full mix graph on any context (live AudioContext or
 * OfflineAudioContext, so preview and export stay identical):
 * clips -> clipGain -> bass -> mid -> treble [-> enhance chain] -> destination.
 *
 * `from` is the transport position to start at; `startTime` is the context
 * time at which that position should sound (pass a little headroom when live).
 */
export function buildMixGraph(
  ctx: BaseAudioContext,
  clips: Clip[],
  master: Master,
  from: number,
  startTime: number,
): MixGraph {
  const bass = new BiquadFilterNode(ctx, { type: "lowshelf", frequency: 100, gain: master.bass });
  const mid = new BiquadFilterNode(ctx, { type: "peaking", frequency: 1000, Q: 1, gain: master.mid });
  const treble = new BiquadFilterNode(ctx, { type: "highshelf", frequency: 3000, gain: master.treble });
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

  const sources: AudioBufferSourceNode[] = [];
  const clipGains = new Map<number, GainNode>();
  for (const clip of clips) {
    const buffer = getBuffer(clip.fileId);
    if (!buffer) continue;
    const endT = clip.offset + (clip.end - clip.start) / clip.speed;
    if (from >= endT) continue;
    const src = new AudioBufferSourceNode(ctx, { buffer, playbackRate: clip.speed });
    const gain = new GainNode(ctx, { gain: clip.muted ? 0 : clip.gain });
    src.connect(gain);
    gain.connect(bass);
    const when = startTime + Math.max(0, clip.offset - from);
    const sourceOffset = clip.start + Math.max(0, from - clip.offset) * clip.speed;
    src.start(when, sourceOffset, clip.end - sourceOffset);
    sources.push(src);
    clipGains.set(clip.id, gain);
  }
  return { sources, clipGains, eq: { bass, mid, treble } };
}
