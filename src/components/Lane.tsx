import type { Clip } from "../types";
import type { Action } from "../state";
import { textOn } from "../state";
import type { EnvPoint } from "../audio/envelope";
import { keyLabel, NOTES, segmentAt, type KeySegment } from "../audio/key";
import { clamp, clipLength, fmt, round1 } from "../utils/time";
import NumBox from "./NumBox";
import Waveform from "./Waveform";
import TimeBox from "./TimeBox";

interface Props {
  laneClips: Clip[]; // clips sharing this row, sorted by offset
  laneIndex: number;
  laneCount: number;
  pps: number;
  width: number;
  gridPx: number;
  laneHeightPx: number;
  dispatch: React.Dispatch<Action>;
  onSeek: (t: number) => void;
  previewId: number | null;
  onPlayTrack: (id: number) => void;
  keys: Record<string, KeySegment[]>;
  position: number;
  selectedId: number | null;
  onSelect: (id: number) => void;
  collapsed: boolean;
  onToggleCollapse: () => void;
}

export default function Lane({
  laneClips, laneIndex, laneCount, pps, width, gridPx, laneHeightPx,
  dispatch, onSeek, previewId, onPlayTrack, keys, position, selectedId, onSelect,
  collapsed, onToggleCollapse,
}: Props) {
  // the header edits one clip of the lane: the selected one, else the first
  const clip = laneClips.find((c) => c.id === selectedId) ?? laneClips[0];
  const update = (patch: Partial<Clip>) => dispatch({ type: "UPDATE_CLIP", id: clip.id, patch });
  const previewing = previewId === clip.id;

  // Key at the playhead, mapped into source time and transposed by the pitch
  // shift; a "*" marks files whose cut spans a key change (modulation).
  const keySegments = keys[clip.fileId];
  const srcT = clamp(clip.start + (position - clip.offset) * clip.speed, clip.start, clip.end);
  const seg = keySegments?.length ? segmentAt(keySegments, srcT) : undefined;
  const inCut = keySegments?.filter((s, i) => {
    const end = keySegments[i + 1]?.start ?? Infinity;
    return end > clip.start && s.start < clip.end;
  }) ?? [];
  const keyTitle = inCut
    .map((s) => `${fmt(Math.max(s.start, clip.start))} ${keyLabel(s, clip.pitch)}`)
    .join(" → ");
  const shownTonic = seg ? (((seg.tonic + clip.pitch) % 12) + 12) % 12 : 0;

  /** Transpose the whole track so the key at the playhead becomes `target`. */
  const setScale = (target: number) => {
    let delta = (target - shownTonic + 12) % 12;
    if (delta > 6) delta -= 12; // shift the shorter way
    let pitch = clip.pitch + delta;
    if (pitch > 12) pitch -= 12;
    if (pitch < -12) pitch += 12;
    update({ pitch });
  };

  const startDrag = (c: Clip, e: React.PointerEvent, mode: "move" | "left" | "right") => {
    e.preventDefault();
    e.stopPropagation();
    onSelect(c.id);
    const el = e.currentTarget as HTMLElement;
    el.setPointerCapture(e.pointerId);
    const x0 = e.clientX;
    const y0 = e.clientY;
    const patchClip = (patch: Partial<Clip>) => dispatch({ type: "UPDATE_CLIP", id: c.id, patch });
    const snap = { start: c.start, end: c.end, offset: c.offset };
    let dy = 0;
    const onMove = (ev: PointerEvent) => {
      const dx = (ev.clientX - x0) / pps; // timeline seconds
      if (mode === "move") {
        patchClip({ offset: Math.max(0, round1(snap.offset + dx)) });
        // vertical: preview sliding toward another lane
        dy = ev.clientY - y0;
        const block = el.closest(".block") as HTMLElement | null ?? el;
        block.style.transform = Math.abs(dy) > laneHeightPx / 3 ? `translateY(${dy}px)` : "";
      } else if (mode === "left") {
        // Trimming the head: the block's left edge follows the cut, DAW-style.
        const s = clamp(round1(snap.start + dx * c.speed), Math.max(0, snap.start - snap.offset * c.speed), snap.end - 0.5);
        patchClip({ start: s, offset: Math.max(0, round1(snap.offset + (s - snap.start) / c.speed)) });
      } else {
        patchClip({ end: clamp(round1(snap.end + dx * c.speed), snap.start + 0.5, c.dur) });
      }
    };
    const onUp = () => {
      el.removeEventListener("pointermove", onMove);
      el.removeEventListener("pointerup", onUp);
      const block = el.closest(".block") as HTMLElement | null ?? el;
      block.style.transform = "";
      const laneDelta = Math.round(dy / laneHeightPx);
      if (mode === "move" && laneDelta !== 0)
        dispatch({ type: "SET_LANE", id: c.id, lane: laneIndex + laneDelta });
    };
    el.addEventListener("pointermove", onMove);
    el.addEventListener("pointerup", onUp);
  };

  /**
   * Vertical drag on a track's volume line: full lane height spans gain 0–2
   * (1 = middle). Applies live; a tap (no movement) can run a fallback action.
   */
  const startVolDrag = (c: Clip, e: React.PointerEvent, pxRange: number, onTap?: () => void) => {
    e.stopPropagation();
    e.preventDefault();
    onSelect(c.id);
    const el = e.currentTarget as HTMLElement;
    el.setPointerCapture(e.pointerId);
    const y0 = e.clientY;
    const g0 = Math.min(c.gain, 2);
    let moved = false;
    const onMove = (ev: PointerEvent) => {
      const dy = ev.clientY - y0;
      if (Math.abs(dy) > 3) moved = true;
      if (!moved) return;
      const g = Math.round(clamp(g0 - (dy / pxRange) * 2, 0, 2) * 20) / 20;
      dispatch({ type: "UPDATE_CLIP", id: c.id, patch: { gain: g } });
    };
    const onUp = () => {
      el.removeEventListener("pointermove", onMove);
      el.removeEventListener("pointerup", onUp);
      if (!moved) onTap?.();
    };
    el.addEventListener("pointermove", onMove);
    el.addEventListener("pointerup", onUp);
  };

  const setEnv = (c: Clip, env: EnvPoint[] | null) =>
    dispatch({ type: "UPDATE_CLIP", id: c.id, patch: { env } });

  /** Drag one envelope point in time (x) and gain (y). */
  const startPointDrag = (c: Clip, idx: number, e: React.PointerEvent, widthPx: number) => {
    e.stopPropagation();
    e.preventDefault();
    onSelect(c.id);
    const el = e.currentTarget as HTMLElement;
    el.setPointerCapture(e.pointerId);
    const svg = el.closest(".vol-env")!.getBoundingClientRect();
    const cut = c.end - c.start;
    const onMove = (ev: PointerEvent) => {
      const t = clamp(c.start + ((ev.clientX - svg.left) / widthPx) * cut, c.start, c.end);
      const g = Math.round(clamp((1 - (ev.clientY - svg.top) / svg.height) * 2, 0, 2) * 20) / 20;
      const env = [...(c.env ?? [])];
      env[idx] = { t: Math.round(t * 10) / 10, g };
      setEnv(c, env.sort((a, b) => a.t - b.t));
    };
    const onUp = () => {
      el.removeEventListener("pointermove", onMove);
      el.removeEventListener("pointerup", onUp);
    };
    el.addEventListener("pointermove", onMove);
    el.addEventListener("pointerup", onUp);
  };

  const fx = (c: Clip) =>
    [
      c.speed !== 1 && `speed ${c.speed}×`,
      c.pitch !== 0 && `pitch ${c.pitch > 0 ? "+" : ""}${c.pitch}`,
    ].filter(Boolean);

  if (collapsed) {
    return (
      <div className="lane-row">
        <div className="lane-head mini">
          <button className="mv" title="Expand this lane" onClick={onToggleCollapse}>▸</button>
          <span className="dot" style={{ background: clip.color }} />
          <span className="mini-name">{clip.name}</span>
          {laneClips.length > 1 && <span className="hint">×{laneClips.length}</span>}
        </div>
        <div
          className="lane mini"
          style={{ width }}
          onClick={(e) => {
            if (e.target !== e.currentTarget) return;
            const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
            onSeek((e.clientX - rect.left) / pps);
          }}
        >
          {laneClips.map((c) => (
            <div
              key={c.id}
              className="mini-block"
              title={`${c.name} · vol ${c.gain} — drag up/down to change volume, click to expand`}
              style={{
                left: c.offset * pps,
                width: Math.max(clipLength(c) * pps, 6),
                top: `${(1 - Math.min(c.gain, 2) / 2) * 100}%`,
                background: c.color,
              }}
              onPointerDown={(e) => startVolDrag(c, e, 80, onToggleCollapse)}
            />
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="lane-row">
      <div className="lane-head">
        <div className="row">
          <button className="mv" title="Minimise this lane to a thin line" onClick={onToggleCollapse}>▾</button>
          <input
            className="color"
            type="color"
            value={clip.color}
            title="Track colour"
            onChange={(e) => update({ color: e.target.value })}
          />
          <input
            className="name"
            type="text"
            value={clip.name}
            title="Track name — click to rename"
            spellCheck={false}
            onChange={(e) => update({ name: e.target.value })}
          />
          <button className="remove" title="Remove this clip"
            onClick={() => dispatch({ type: "REMOVE_CLIP", id: clip.id })}>✕</button>
        </div>
        <div className="row">
          {seg && (
            <span
              className="key-wrap"
              title={`Key at the playhead${clip.pitch ? " (incl. pitch shift)" : ""}${inCut.length > 1 ? ` — changes: ${keyTitle}` : ""}. Pick a key to transpose the track (adjusts Pitch, formants preserved).`}
            >
              <select
                className="key-badge"
                value={shownTonic}
                onChange={(e) => setScale(Number(e.target.value))}
              >
                {NOTES.map((note, t) => {
                  let d = (t - shownTonic + 12) % 12;
                  if (d > 6) d -= 12;
                  const mode = seg.mode === "major" ? "maj" : "min";
                  return (
                    <option key={note} value={t}>
                      ♪ {note} {mode}{d ? ` (${d > 0 ? "+" : ""}${d})` : ""}
                    </option>
                  );
                })}
              </select>
              {inCut.length > 1 ? "*" : ""}
            </span>
          )}
          <button
            className={`preview ${previewing ? "on" : ""}`}
            title={previewing ? "Stop" : "Play this track alone"}
            onClick={() => onPlayTrack(clip.id)}
          >{previewing ? "⏹" : "▶"}</button>
          <button
            className={`mute ${clip.muted ? "on" : ""}`}
            title={clip.muted ? "Unmute" : "Mute this track"}
            onClick={() => update({ muted: !clip.muted })}
          >M</button>
          <button className="mv" disabled={laneIndex === 0} title="Move lane up"
            onClick={() => dispatch({ type: "MOVE_CLIP", id: clip.id, dir: -1 })}>▲</button>
          <button className="mv" disabled={laneIndex === laneCount - 1} title="Move lane down"
            onClick={() => dispatch({ type: "MOVE_CLIP", id: clip.id, dir: 1 })}>▼</button>
          <button className="mv" title="Duplicate this track (with all its settings) into a new lane below"
            onClick={() => dispatch({ type: "DUPLICATE_LANE", id: clip.id })}>⧉</button>
          <input
            className="vol-slider"
            type="range"
            min={0}
            max={2}
            step={0.05}
            value={Math.min(clip.gain, 2)}
            title={`Volume: ${clip.gain} — drag for live changes (fine values in the Vol box)`}
            onChange={(e) => update({ gain: Number(e.target.value) })}
          />
          {laneClips.length > 1 && (
            <span className="hint" title="This lane holds several clips — click a block to edit it here">
              {laneClips.length} clips
            </span>
          )}
        </div>
        <div className="row ctl">
          <TimeBox label="From" title="Cut from — where in the source the clip starts"
            value={clip.start} onCommit={(v) => update({ start: clamp(v, 0, clip.end - 0.5) })} />
          <TimeBox label="To" title="Cut to — where in the source the clip ends"
            value={clip.end} onCommit={(v) => update({ end: clamp(v, clip.start + 0.5, clip.dur) })} />
          <TimeBox label="At" title="Place at — where on the mix timeline the clip starts"
            value={clip.offset} onCommit={(v) => update({ offset: Math.max(0, v) })} />
        </div>
        <div className="row ctl">
          <NumBox label="Vol" title="Volume: 1 = original, 0.5 = half, 2 = double"
            value={clip.gain} min={0} max={10} step={0.1}
            onCommit={(v) => update({ gain: v })} />
          <NumBox label="Speed" title="Speed: 0.5 = half speed, 2 = double (pitch preserved) — applies on Enter or leaving the box"
            value={clip.speed} min={0.5} max={2} step={0.05}
            onCommit={(v) => update({ speed: v })} />
          <NumBox label="Pitch" title="Pitch in semitones, −12…+12 (speed and vocal timbre preserved) — applies on Enter or leaving the box"
            value={clip.pitch} min={-12} max={12} step={1}
            onCommit={(v) => update({ pitch: Math.round(v) })} />
        </div>
      </div>
      <div
        className="lane"
        style={{ width, backgroundSize: `${gridPx}px 100%` }}
        onClick={(e) => {
          if (e.target !== e.currentTarget) return; // blocks handle their own events
          const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
          onSeek((e.clientX - rect.left) / pps);
        }}
      >
        {laneClips.map((c) => {
          const len = clipLength(c);
          return (
            <div
              key={c.id}
              className={`block ${c.muted ? "muted" : ""} ${c.id === clip.id ? "selected" : ""}`}
              style={{
                left: c.offset * pps,
                width: Math.max(len * pps, 24),
                background: c.color,
                color: textOn(c.color),
              }}
              title={`${c.name} · plays ${fmt(c.offset)}–${fmt(c.offset + len)} · cut ${fmt(c.start)}–${fmt(c.end)}${keyTitle && c.id === clip.id ? `\nKey${c.pitch ? " (incl. pitch shift)" : ""}: ${keyTitle}` : ""}\nDrag up/down to move to another lane`}
              onPointerDown={(e) => startDrag(c, e, "move")}
              onDoubleClick={(e) => {
                // double-click anywhere on the block: add a volume point there
                const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
                const t = c.start + ((e.clientX - rect.left) / rect.width) * (c.end - c.start);
                const g = Math.round(clamp((1 - (e.clientY - rect.top) / rect.height) * 2, 0, 2) * 20) / 20;
                setEnv(c, [...(c.env ?? []), { t: Math.round(t * 10) / 10, g }].sort((a, b) => a.t - b.t));
              }}
            >
              <Waveform clip={c} widthPx={Math.max(len * pps, 24)} color={textOn(c.color)} />
              {c.env?.length ? (
                <div className="vol-env" style={{ color: textOn(c.color) }}>
                  {(() => {
                    const W = Math.max(len * pps, 24);
                    const cut = c.end - c.start;
                    const px = (t: number) => ((t - c.start) / cut) * 100; // percent
                    const py = (g: number) => (1 - Math.min(g, 2) / 2) * 100;
                    const pts = [...c.env!].sort((a, b) => a.t - b.t);
                    const poly = [
                      `0,${py(pts[0].g)}`,
                      ...pts.map((p) => `${px(p.t)},${py(p.g)}`),
                      `100,${py(pts[pts.length - 1].g)}`,
                    ].join(" ");
                    return (
                      <>
                        <svg viewBox="0 0 100 100" preserveAspectRatio="none">
                          <polyline className="env-line" points={poly} vectorEffect="non-scaling-stroke" />
                          <polyline
                            className="env-line-hit"
                            points={poly}
                            vectorEffect="non-scaling-stroke"
                            onPointerDown={(e) => { e.stopPropagation(); onSelect(c.id); }}
                            onDoubleClick={(e) => {
                              e.stopPropagation();
                              const svg = (e.currentTarget as SVGElement).closest(".vol-env")!.getBoundingClientRect();
                              const t = c.start + ((e.clientX - svg.left) / svg.width) * cut;
                              const g = Math.round(clamp((1 - (e.clientY - svg.top) / svg.height) * 2, 0, 2) * 20) / 20;
                              setEnv(c, [...pts, { t: Math.round(t * 10) / 10, g }].sort((a, b) => a.t - b.t));
                            }}
                          />
                        </svg>
                        {pts.map((p, i) => (
                          <div
                            key={i}
                            className="env-pt"
                            style={{ left: `${px(p.t)}%`, top: `${py(p.g)}%` }}
                            title={`${fmt(p.t)} → ${p.g}× — drag to move, double-click to delete`}
                            onPointerDown={(e) => startPointDrag(c, i, e, W)}
                            onDoubleClick={(e) => {
                              e.stopPropagation();
                              const env = pts.filter((_, k) => k !== i);
                              setEnv(c, env.length ? env : null);
                            }}
                          />
                        ))}
                      </>
                    );
                  })()}
                </div>
              ) : (
                <div
                  className="vol-line"
                  style={{ top: `${(1 - Math.min(c.gain, 2) / 2) * 100}%`, color: textOn(c.color) }}
                  title={`Volume ${c.gain} — drag up/down to change; double-click the block to start a volume curve`}
                  onPointerDown={(e) => startVolDrag(c, e, laneHeightPx)}
                >
                  {c.gain !== 1 && <span className="vol-val">{c.gain}×</span>}
                </div>
              )}
              <div className="handle left" onPointerDown={(e) => startDrag(c, e, "left")} />
              <div className="body">
                <div className="place">▶ {fmt(c.offset)}–{fmt(c.offset + len)}</div>
                <div className="cut">cut {fmt(c.start)}–{fmt(c.end)}</div>
                <div className="fx">{fx(c).join(" · ")}</div>
              </div>
              <div className="handle right" onPointerDown={(e) => startDrag(c, e, "right")} />
            </div>
          );
        })}
      </div>
    </div>
  );
}
