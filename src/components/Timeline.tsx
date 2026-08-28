import { useRef, useState } from "react";
import type { Clip } from "../types";
import type { Action } from "../state";
import type { KeySegment } from "../audio/key";
import { clamp, fmt, fmtTick, mixLength, parseTime } from "../utils/time";
import Lane from "./Lane";

interface Props {
  clips: Clip[];
  dispatch: React.Dispatch<Action>;
  position: number;
  onSeek: (t: number) => void;
  previewId: number | null;
  onPlayTrack: (id: number) => void;
  keys: Record<string, KeySegment[]>;
}

function rulerStep(pps: number): number {
  // smallest step keeping labels >= ~70px apart at this zoom
  for (const s of [1, 2, 5, 10, 15, 30, 60, 120, 300, 600]) if (s * pps >= 70) return s;
  return 600;
}

export default function Timeline({ clips, dispatch, position, onSeek, previewId, onPlayTrack, keys }: Props) {
  const [pps, setPps] = useState(3); // pixels per second (zoom)
  const [scrub, setScrub] = useState<number | null>(null); // playhead while dragging
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [collapsed, setCollapsed] = useState<Set<number>>(new Set());
  const [timeText, setTimeText] = useState<string | null>(null); // playhead chip being edited
  const scrollRef = useRef<HTMLDivElement>(null);
  const rulerRef = useRef<HTMLDivElement>(null);

  // clips grouped into lanes (a lane can hold several clips, i.e. a group)
  const laneCount = clips.length ? Math.max(...clips.map((c) => c.lane)) + 1 : 0;
  const lanes = Array.from({ length: laneCount }, (_, i) =>
    clips.filter((c) => c.lane === i).sort((a, b) => a.offset - b.offset),
  ).filter((l) => l.length);

  const commitTime = () => {
    if (timeText !== null) {
      const v = parseTime(timeText);
      if (v !== null && !Number.isNaN(v)) onSeek(clamp(v, 0, mixLength(clips)));
    }
    setTimeText(null);
  };

  const span = Math.max(60, mixLength(clips)) + 30;
  const width = span * pps;
  const step = rulerStep(pps);
  const ticks = [];
  for (let t = 0; t <= span; t += step) ticks.push(t);

  const setZoom = (next: number) => setPps(clamp(next, 0.3, 60));

  // Press anywhere on the ruler or grab the playhead, then drag to scrub.
  // The line follows the pointer; the seek commits on release (a plain click
  // still seeks), so playback isn't rebuilt on every pointermove.
  const startScrub = (e: React.PointerEvent) => {
    e.preventDefault();
    e.stopPropagation();
    const timeAt = (clientX: number) => {
      const rect = rulerRef.current!.getBoundingClientRect();
      return clamp((clientX - rect.left) / pps, 0, mixLength(clips));
    };
    const el = e.currentTarget as HTMLElement;
    el.setPointerCapture(e.pointerId);
    setScrub(timeAt(e.clientX));
    const onMove = (ev: PointerEvent) => setScrub(timeAt(ev.clientX));
    const onUp = (ev: PointerEvent) => {
      onSeek(timeAt(ev.clientX));
      setScrub(null);
      el.removeEventListener("pointermove", onMove);
      el.removeEventListener("pointerup", onUp);
    };
    el.addEventListener("pointermove", onMove);
    el.addEventListener("pointerup", onUp);
  };
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
              ref={rulerRef}
              style={{ width }}
              title="Click or drag to seek"
              onPointerDown={startScrub}
            >
              {ticks.map((t) => (
                <div key={t} className="tick" style={{ left: t * pps }}>{fmtTick(t)}</div>
              ))}
            </div>
          </div>
          {lanes.map((laneClips) => (
            <Lane
              key={laneClips[0].lane}
              laneClips={laneClips}
              laneIndex={laneClips[0].lane}
              laneCount={lanes.length}
              pps={pps}
              width={width}
              gridPx={step * pps}
              laneHeightPx={112} /* .lane height: 7rem */
              dispatch={dispatch}
              onSeek={onSeek}
              previewId={previewId}
              onPlayTrack={onPlayTrack}
              keys={keys}
              position={scrub ?? position}
              selectedId={selectedId}
              onSelect={setSelectedId}
              collapsed={collapsed.has(laneClips[0].lane)}
              onToggleCollapse={() =>
                setCollapsed((prev) => {
                  const next = new Set(prev);
                  const lane = laneClips[0].lane;
                  if (next.has(lane)) next.delete(lane);
                  else next.add(lane);
                  return next;
                })
              }
            />
          ))}
          <div
            className={`playhead ${scrub !== null ? "scrubbing" : ""}`}
            style={{ left: `calc(21rem + ${(scrub ?? position) * pps}px)` }}
          >
            <div className="ph-line" />
            <div className="ph-grab" title="Drag to seek" onPointerDown={startScrub}>
              <div className="ph-cap" />
            </div>
            {timeText !== null ? (
              <input
                className="ph-time-input"
                autoFocus
                value={timeText}
                spellCheck={false}
                onChange={(e) => setTimeText(e.target.value)}
                onBlur={commitTime}
                onKeyDown={(e) => {
                  if (e.key === "Enter") (e.target as HTMLInputElement).blur();
                  if (e.key === "Escape") setTimeText(null);
                }}
                onPointerDown={(e) => e.stopPropagation()}
              />
            ) : (
              <div
                className="ph-time"
                title="Click to type an exact time (e.g. 1:23.5)"
                onPointerDown={(e) => e.stopPropagation()}
                onClick={(e) => {
                  // on click, not pointerdown: the same press's trailing
                  // mousedown would blur (and instantly close) the editor
                  e.stopPropagation();
                  setTimeText(fmt(scrub ?? position));
                }}
              >{fmt(scrub ?? position)}</div>
            )}
          </div>
          </div>
        </div>
      </div>
    </>
  );
}
