import type { Clip } from "../types";
import type { Action } from "../state";
import { textOn } from "../state";
import { keyLabel, NOTES, segmentAt, type KeySegment } from "../audio/key";
import { clamp, clipLength, fmt, round1 } from "../utils/time";
import TimeBox from "./TimeBox";

interface Props {
  clip: Clip;
  index: number;
  count: number;
  pps: number;
  width: number;
  gridPx: number;
  dispatch: React.Dispatch<Action>;
  onSeek: (t: number) => void;
  previewing: boolean;
  onPlayTrack: (id: number) => void;
  keySegments?: KeySegment[];
  position: number;
}

export default function Lane({ clip, index, count, pps, width, gridPx, dispatch, onSeek, previewing, onPlayTrack, keySegments, position }: Props) {
  const update = (patch: Partial<Clip>) => dispatch({ type: "UPDATE_CLIP", id: clip.id, patch });
  const len = clipLength(clip);

  // Key at the playhead, mapped into source time and transposed by the pitch
  // shift; a "*" marks files whose cut spans a key change (modulation).
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

  const startDrag = (e: React.PointerEvent, mode: "move" | "left" | "right") => {
    e.preventDefault();
    e.stopPropagation();
    const el = e.currentTarget as HTMLElement;
    el.setPointerCapture(e.pointerId);
    const x0 = e.clientX;
    const snap = { start: clip.start, end: clip.end, offset: clip.offset };
    const onMove = (ev: PointerEvent) => {
      const dx = (ev.clientX - x0) / pps; // timeline seconds
      if (mode === "move") {
        update({ offset: Math.max(0, round1(snap.offset + dx)) });
      } else if (mode === "left") {
        // Trimming the head: the block's left edge follows the cut, DAW-style.
        const s = clamp(round1(snap.start + dx * clip.speed), Math.max(0, snap.start - snap.offset * clip.speed), snap.end - 0.5);
        update({ start: s, offset: Math.max(0, round1(snap.offset + (s - snap.start) / clip.speed)) });
      } else {
        update({ end: clamp(round1(snap.end + dx * clip.speed), snap.start + 0.5, clip.dur) });
      }
    };
    const onUp = () => {
      el.removeEventListener("pointermove", onMove);
      el.removeEventListener("pointerup", onUp);
    };
    el.addEventListener("pointermove", onMove);
    el.addEventListener("pointerup", onUp);
  };

  const fx = [
    clip.speed !== 1 && `speed ${clip.speed}×`,
    clip.pitch !== 0 && `pitch ${clip.pitch > 0 ? "+" : ""}${clip.pitch}`,
  ].filter(Boolean);

  return (
    <div className="lane-row">
      <div className="lane-head">
        <div className="row">
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
          <button className="remove" title="Remove"
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
          <button className="mv" disabled={index === 0} title="Move up"
            onClick={() => dispatch({ type: "MOVE_CLIP", id: clip.id, dir: -1 })}>▲</button>
          <button className="mv" disabled={index === count - 1} title="Move down"
            onClick={() => dispatch({ type: "MOVE_CLIP", id: clip.id, dir: 1 })}>▼</button>
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
          <label title="Volume: 1 = original, 0.5 = half, 2 = double">Vol
            <input type="number" min={0} max={10} step={0.1} value={clip.gain}
              onChange={(e) => update({ gain: Number(e.target.value) || 1 })} />
          </label>
          <label title="Speed: 0.5 = half speed, 2 = double (pitch preserved)">Speed
            <input type="number" min={0.5} max={2} step={0.05} value={clip.speed}
              onChange={(e) => update({ speed: Number(e.target.value) || 1 })} />
          </label>
          <label title="Pitch in semitones, −12…+12 (speed and vocal timbre preserved)">Pitch
            <input type="number" min={-12} max={12} step={1} value={clip.pitch}
              onChange={(e) => update({ pitch: Number(e.target.value) || 0 })} />
          </label>
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
        <div
          className={`block ${clip.muted ? "muted" : ""}`}
          style={{
            left: clip.offset * pps,
            width: Math.max(len * pps, 24),
            background: clip.color,
            color: textOn(clip.color),
          }}
          title={`Plays ${fmt(clip.offset)}–${fmt(clip.offset + len)} · cut ${fmt(clip.start)}–${fmt(clip.end)} of ${clip.name}${keyTitle ? `\nKey${clip.pitch ? " (incl. pitch shift)" : ""}: ${keyTitle}` : ""}`}
          onPointerDown={(e) => startDrag(e, "move")}
        >
          <div className="handle left" onPointerDown={(e) => startDrag(e, "left")} />
          <div className="body">
            <div className="place">▶ {fmt(clip.offset)}–{fmt(clip.offset + len)}</div>
            <div className="cut">cut {fmt(clip.start)}–{fmt(clip.end)}</div>
            <div className="fx">{fx.join(" · ")}</div>
          </div>
          <div className="handle right" onPointerDown={(e) => startDrag(e, "right")} />
        </div>
      </div>
    </div>
  );
}
