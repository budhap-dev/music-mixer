import { useEffect, useReducer, useRef, useState } from "react";
import { Engine } from "./audio/engine";
import { exportMp3 } from "./audio/export";
import { importFile } from "./audio/files";
import { ensureProcessed, needsProcessing } from "./audio/process";
import { historyReducer, initialHistory } from "./state";
import { clamp, clipLength, fmt, mixLength } from "./utils/time";
import MasterPanel from "./components/MasterPanel";
import ThemePicker from "./components/ThemePicker";
import Timeline from "./components/Timeline";

export default function App() {
  const [history, dispatch] = useReducer(historyReducer, initialHistory);
  const state = history.present;
  const [status, setStatus] = useState("");
  const engineRef = useRef<Engine | null>(null);
  const engine = (engineRef.current ??= new Engine());
  const [playing, setPlaying] = useState(false);
  const [pos, setPos] = useState(0);
  // track being previewed alone via its lane ▶ button (and where the preview
  // began, so stopping returns there); null = full mix
  const [preview, setPreview] = useState<{ id: number; from: number } | null>(null);
  const previewId = preview?.id ?? null;
  const [exportProgress, setExportProgress] = useState<number | null>(null);

  const total = mixLength(state.clips);
  const previewClip = preview === null ? undefined : state.clips.find((c) => c.id === preview.id);
  // what the engine should hear: one track (unmuted) while previewing, else the mix
  const audible = (id: number | null) =>
    id === null ? state.clips : state.clips.filter((c) => c.id === id).map((c) => ({ ...c, muted: false }));
  const stopAt = previewClip ? previewClip.offset + clipLength(previewClip) : total;

  const openFiles = async (list: FileList | null) => {
    if (!list?.length) return;
    for (const file of Array.from(list)) {
      setStatus(`Loading ${file.name}…`);
      try {
        const { id, name, duration } = await importFile(file);
        dispatch({ type: "ADD_CLIP", fileId: id, name, duration });
      } catch {
        setStatus(`Couldn't read ${file.name} as audio.`);
        return;
      }
    }
    setStatus("");
  };

  const playPause = () => {
    if (playing) {
      engine.pause();
      setPlaying(false);
      setPreview(null);
      setPos(engine.position());
    } else {
      const from = engine.position() >= total ? 0 : engine.position();
      engine.play(state.clips, state.master, from);
      setPreview(null);
      setPlaying(true);
    }
  };

  const stopAll = () => {
    engine.stop();
    setPlaying(false);
    setPreview(null);
    setPos(0);
  };

  /**
   * Lane ▶: play this track alone — from the playhead if it sits inside the
   * track's span, else from the track's start; ⏹ stops it.
   */
  const playTrack = (id: number) => {
    if (playing && previewId === id) {
      engine.pause();
      setPlaying(false);
      setPreview(null);
      setPos(engine.position());
      return;
    }
    const clip = state.clips.find((c) => c.id === id);
    if (!clip) return;
    const cur = engine.position();
    const inSpan = cur >= clip.offset && cur < clip.offset + clipLength(clip);
    const from = inSpan ? cur : clip.offset;
    engine.play(audible(id), state.master, from);
    setPreview({ id, from });
    setPlaying(true);
    setPos(from);
  };

  const exportMix = async () => {
    if (exportProgress !== null) return;
    setExportProgress(0);
    setStatus("");
    try {
      await exportMp3(state.clips, state.master, state.mixTitle, setExportProgress);
    } catch {
      setStatus("Export failed — try again.");
    } finally {
      setExportProgress(null);
    }
  };

  const seek = (t: number) => {
    const target = clamp(t, 0, total);
    if (playing) engine.play(audible(previewId), state.master, target);
    else engine.setPosition(target);
    setPos(target);
  };

  // ⌘Z / Ctrl+Z undo, ⇧⌘Z / Ctrl+Shift+Z redo — text fields keep native undo
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!(e.metaKey || e.ctrlKey) || e.key.toLowerCase() !== "z") return;
      const tag = (e.target as HTMLElement).tagName;
      if (tag === "INPUT" || tag === "TEXTAREA") return;
      e.preventDefault();
      dispatch({ type: e.shiftKey ? "REDO" : "UNDO" });
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  // transport clock + end handling (end of mix, or end of the previewed track)
  useEffect(() => {
    if (!playing) return;
    const restart = preview?.from ?? 0;
    let raf = 0;
    const tick = () => {
      const p = engine.position();
      if (p >= stopAt) {
        engine.pause();
        engine.setPosition(restart);
        setPlaying(false);
        setPreview(null);
        setPos(restart);
        return;
      }
      setPos(p);
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [playing, stopAt, preview, engine]);

  // volume & mute apply live, no rebuild (a previewed track ignores its mute)
  useEffect(() => {
    for (const c of state.clips)
      engine.setClipGain(c.id, c.muted && c.id !== previewId ? 0 : c.gain);
  }, [state.clips, previewId, engine]);

  // EQ sliders apply live, no rebuild
  const { bass, mid, treble } = state.master;
  useEffect(() => {
    engine.setMaster(state.master);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bass, mid, treble, engine]);

  // formant-preserved speed/pitch renditions (Rubber Band, in a worker):
  // debounce typing, then process; bump procTick so a playing graph rebuilds
  // with the processed audio once it's ready
  const [procTick, setProcTick] = useState(0);
  const procSig = JSON.stringify(
    state.clips.filter(needsProcessing).map((c) => [c.fileId, c.speed, c.pitch]),
  );
  useEffect(() => {
    if (procSig === "[]") return;
    let stale = false;
    const t = setTimeout(() => {
      setStatus("Rendering speed/pitch…");
      ensureProcessed(state.clips, (v) => {
        if (!stale) setStatus(`Rendering speed/pitch… ${Math.round(v * 100)}%`);
      })
        .then(() => {
          if (stale) return;
          setStatus("");
          setProcTick((n) => n + 1);
        })
        .catch(() => { if (!stale) setStatus("Speed/pitch rendering failed."); });
    }, 300);
    return () => { stale = true; clearTimeout(t); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [procSig]);

  // structural edits (cuts, moves, speed/pitch, add/remove, enhance) rebuild mid-play
  const structSig =
    JSON.stringify(state.clips.map((c) => [c.fileId, c.start, c.end, c.offset, c.speed, c.pitch])) +
    state.master.enhance + procTick;
  useEffect(() => {
    if (!engine.playing) return;
    const t = setTimeout(() => engine.play(audible(previewId), state.master, engine.position()), 150);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [structSig]);

  return (
    <div className="app">
      <div className="topbar">
        <h1>🎚 Music Mixer</h1>
        <ThemePicker />
      </div>
      <p>
        Cut, layer, speed/pitch-shift and EQ your audio — entirely in this browser tab.
        Your files are opened, not uploaded: nothing leaves your machine.
      </p>
      <div className="sources">
        <label className="upload-label">
          ⬆ Open audio files
          <input type="file" accept="audio/*" multiple
            onChange={(e) => { void openFiles(e.target.files); e.target.value = ""; }} />
        </label>
        {state.clips.length > 0 && (
          <div className="transport">
            <button onClick={playPause}>{playing ? "⏸ Pause" : "▶ Play"}</button>
            <button className="mode-btn" onClick={stopAll} title="Stop and return to start">⏹</button>
            <span className="clock">{fmt(pos)} / {fmt(total)}</span>
          </div>
        )}
        <div className="undo-redo">
          <button className="mode-btn" disabled={!history.past.length}
            title="Undo (⌘Z / Ctrl+Z)" onClick={() => dispatch({ type: "UNDO" })}>↩ Undo</button>
          <button className="mode-btn" disabled={!history.future.length}
            title="Redo (⇧⌘Z / Ctrl+Shift+Z)" onClick={() => dispatch({ type: "REDO" })}>↪ Redo</button>
        </div>
      </div>
      <div className="status">{status}</div>
      {state.clips.length === 0 ? (
        <div className="hint">Nothing on the timeline yet — open one or more audio files to start cutting.</div>
      ) : (
        <>
          <Timeline clips={state.clips} dispatch={dispatch} position={pos} onSeek={seek}
            previewId={playing ? previewId : null} onPlayTrack={playTrack} />
          <MasterPanel master={state.master} dispatch={dispatch} />
          <div className="mix-controls">
            <input
              type="text"
              placeholder="Mix title (optional)"
              value={state.mixTitle}
              onChange={(e) => dispatch({ type: "SET_TITLE", title: e.target.value })}
            />
            <button onClick={() => void exportMix()} disabled={exportProgress !== null}>
              {exportProgress === null
                ? "⬇ Export MP3"
                : `Exporting… ${Math.round(exportProgress * 100)}%`}
            </button>
          </div>
        </>
      )}
    </div>
  );
}
