import type { Clip, Master } from "../types";
import { getBuffer } from "./files";
import { getProcessed, needsProcessing } from "./process";

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
    // Prefer the formant-preserved rendition (speed keeps pitch, pitch keeps
    // speed). Until it's ready, fall back to naive playbackRate so audio
    // still plays; the caller rebuilds once processing completes.
    const processed = needsProcessing(clip) ? getProcessed(clip) : undefined;
    const buffer = processed ?? getBuffer(clip.fileId);
    if (!buffer) continue;
    const unit = (clip.end - clip.start) / clip.speed; // one pass, output-domain
    const loops = clip.loop ?? 1;
    if (from >= clip.offset + unit * loops) continue;
    const gain = new GainNode(ctx, { gain: clip.muted ? 0 : clip.gain });
    gain.connect(bass);
    // each pass of the cut (loop) is its own source into the clip's gain;
    // the final pass may be fractional (loop 1.5 = one and a half times)
    for (let rep = 0; rep < Math.ceil(loops); rep++) {
      const passLen = Math.min(1, loops - rep) * unit;
      const segStart = clip.offset + rep * unit;
      if (from >= segStart + passLen) continue;
      const skip = Math.max(0, from - segStart); // output-domain, into this pass
      const when = startTime + Math.max(0, segStart - from);
      const src = processed
        ? new AudioBufferSourceNode(ctx, { buffer })
        : new AudioBufferSourceNode(ctx, { buffer, playbackRate: clip.speed });
      src.connect(gain);
      if (processed) {
        // processed buffer is the whole file stretched: source t -> t/speed
        src.start(when, clip.start / clip.speed + skip, passLen - skip);
      } else {
        src.start(when, clip.start + skip * clip.speed, (passLen - skip) * clip.speed);
      }
      sources.push(src);
    }
    clipGains.set(clip.id, gain);
  }
  return { sources, clipGains, eq: { bass, mid, treble } };
}
