import { useRef, useState } from "react";
import type { Clip } from "../types";
import type { Action } from "../state";
import { clamp, fmtTick, mixLength } from "../utils/time";
import Lane from "./Lane";

interface Props {
  clips: Clip[];
  dispatch: React.Dispatch<Action>;
  position: number;
  onSeek: (t: number) => void;
}

function rulerStep(pps: number): number {
  // smallest step keeping labels >= ~70px apart at this zoom
  for (const s of [1, 2, 5, 10, 15, 30, 60, 120, 300, 600]) if (s * pps >= 70) return s;
  return 600;
}

export default function Timeline({ clips, dispatch, position, onSeek }: Props) {
  const [pps, setPps] = useState(3); // pixels per second (zoom)
  const scrollRef = useRef<HTMLDivElement>(null);

  const span = Math.max(60, mixLength(clips)) + 30;
  const width = span * pps;
  const step = rulerStep(pps);
  const ticks = [];
  for (let t = 0; t <= span; t += step) ticks.push(t);

  const setZoom = (next: number) => setPps(clamp(next, 0.3, 60));
  const fit = () => {
    const w = scrollRef.current?.clientWidth ?? 800;
    setZoom(w / span);
  };

  return (
    <>
      <div className="zoom">
        <span className="hint">Zoom</span>
        <button className="mode-btn" onClick={() => setZoom(pps / 1.5)} title="Zoom out (or Ctrl/⌘ + scroll)">−</button>
        <button className="mode-btn" onClick={() => setZoom(pps * 1.5)} title="Zoom in (or Ctrl/⌘ + scroll)">+</button>
        <button className="mode-btn" onClick={fit} title="Fit whole mix">Fit</button>
        <span className="hint">Drag blocks to place, drag edges to cut — or type exact times.</span>
      </div>
      <div className="timeline">
        <div
          className="lane-scroll"
          ref={scrollRef}
          onWheel={(e) => {
            if (!(e.ctrlKey || e.metaKey)) return;
            e.preventDefault();
            setZoom(pps * (e.deltaY < 0 ? 1.15 : 1 / 1.15));
          }}
        >
          <div className="scroll-inner">
          <div className="lane-row">
            <div className="ruler-spacer" />
            <div
              className="ruler"
              style={{ width }}
              title="Click to seek"
              onClick={(e) => {
                const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
                onSeek((e.clientX - rect.left) / pps);
              }}
            >
              {ticks.map((t) => (
                <div key={t} className="tick" style={{ left: t * pps }}>{fmtTick(t)}</div>
              ))}
            </div>
          </div>
          {clips.map((clip, i) => (
            <Lane
              key={clip.id}
              clip={clip}
              index={i}
              count={clips.length}
              pps={pps}
              width={width}
              gridPx={step * pps}
              dispatch={dispatch}
              onSeek={onSeek}
            />
          ))}
          <div className="playhead" style={{ left: `calc(19rem + ${position * pps}px)` }} />
          </div>
        </div>
      </div>
    </>
  );
}
