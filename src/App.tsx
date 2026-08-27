import { useEffect, useReducer, useRef, useState } from "react";
import { Engine } from "./audio/engine";
import { exportMp3 } from "./audio/export";
import { importFile } from "./audio/files";
import { initialState, reducer } from "./state";
import { clamp, fmt, mixLength } from "./utils/time";
import MasterPanel from "./components/MasterPanel";
import ThemePicker from "./components/ThemePicker";
import Timeline from "./components/Timeline";

export default function App() {
  const [state, dispatch] = useReducer(reducer, initialState);
  const [status, setStatus] = useState("");
  const engineRef = useRef<Engine | null>(null);
  const engine = (engineRef.current ??= new Engine());
  const [playing, setPlaying] = useState(false);
  const [pos, setPos] = useState(0);
  const [exportProgress, setExportProgress] = useState<number | null>(null);

  const total = mixLength(state.clips);

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
      setPos(engine.position());
    } else {
      const from = engine.position() >= total ? 0 : engine.position();
      engine.play(state.clips, state.master, from);
      setPlaying(true);
    }
  };

  const stopAll = () => {
    engine.stop();
    setPlaying(false);
    setPos(0);
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
    if (playing) engine.play(state.clips, state.master, target);
    else engine.setPosition(target);
    setPos(target);
  };

  // transport clock + end-of-mix handling
  useEffect(() => {
    if (!playing) return;
    let raf = 0;
    const tick = () => {
      const p = engine.position();
      if (p >= total) {
        engine.stop();
        setPlaying(false);
        setPos(0);
        return;
      }
      setPos(p);
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [playing, total, engine]);

  // volume & mute apply live, no rebuild
  useEffect(() => {
    for (const c of state.clips) engine.setClipGain(c.id, c.muted ? 0 : c.gain);
  }, [state.clips, engine]);

  // EQ sliders apply live, no rebuild
  const { bass, mid, treble } = state.master;
  useEffect(() => {
    engine.setMaster(state.master);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bass, mid, treble, engine]);

  // structural edits (cuts, moves, speed, add/remove, enhance) rebuild mid-play
  const structSig =
    JSON.stringify(state.clips.map((c) => [c.fileId, c.start, c.end, c.offset, c.speed])) +
    state.master.enhance;
  useEffect(() => {
    if (!engine.playing) return;
    const t = setTimeout(() => engine.play(state.clips, state.master, engine.position()), 150);
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
      </div>
      <div className="status">{status}</div>
      {state.clips.length === 0 ? (
        <div className="hint">Nothing on the timeline yet — open one or more audio files to start cutting.</div>
      ) : (
        <>
          <Timeline clips={state.clips} dispatch={dispatch} position={pos} onSeek={seek} />
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
