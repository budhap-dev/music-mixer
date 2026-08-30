import { useEffect, useRef } from "react";
import type { Clip } from "../types";
import { envGainAt } from "../audio/envelope";
import { getPeaks, PEAKS_PER_SECOND } from "../audio/peaks";

interface Props {
  clip: Clip;
  widthPx: number; // rendered block width
  color: string; // stroke colour (the block's text colour)
}

// waveform height scales with the clip's volume so the mix reads at a glance

/** The clip's real waveform, drawn across the cut region of its source. */
export default function Waveform({ clip, widthPx, color }: Props) {
  const ref = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const peaks = getPeaks(clip.fileId);
    const w = Math.max(1, Math.min(Math.round(widthPx), 4000));
    const h = canvas.clientHeight || 96;
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext("2d");
    if (!ctx || !peaks) return;
    ctx.clearRect(0, 0, w, h);
    ctx.fillStyle = color;
    ctx.globalAlpha = 0.45;
    const mid = h / 2;
    const cut = clip.end - clip.start;
    for (let x = 0; x < w; x++) {
      // source time at this pixel; loop-independent because the block spans one pass
      const t = clip.start + (x / w) * cut;
      const p = peaks[Math.min(peaks.length - 1, Math.floor(t * PEAKS_PER_SECOND))] ?? 0;
      const factor = Math.min(clip.gain, 2) * (clip.env?.length ? envGainAt(clip.env, t) : 1);
      const half = Math.min(mid - 1, Math.max(0.75, p * (mid - 2) * factor));
      ctx.fillRect(x, mid - half, 1, half * 2);
    }
  }, [clip.fileId, clip.start, clip.end, clip.gain, clip.env, widthPx, color]);

  return <canvas ref={ref} className="wave" />;
}
