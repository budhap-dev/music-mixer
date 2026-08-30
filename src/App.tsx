import { useEffect, useReducer, useRef, useState } from "react";
import { Engine } from "./audio/engine";
import { exportMp3 } from "./audio/export";
import { importFile } from "./audio/files";
import { detectKey, type KeySegment } from "./audio/key";
import {
  autosave, clearSaved, exportProjectBlob, loadSaved, readProjectFile,
  restoreProject, type SavedProject,
} from "./audio/persist";
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
  const [renderProgress, setRenderProgress] = useState<number | null>(null);
  // detected key timeline per source file (shown per lane, follows playhead)
  const [keys, setKeys] = useState<Record<string, KeySegment[]>>({});
  // autosaved session found on startup, offered as a Resume banner
  const [saved, setSaved] = useState<SavedProject | null>(null);

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

  // offer to resume the autosaved session; keep autosave fresh while editing
  useEffect(() => {
    loadSaved().then(setSaved).catch(() => {});
  }, []);
  useEffect(() => {
    if (!state.clips.length) return;
    const t = setTimeout(() => { autosave(state).catch(() => {}); }, 800);
    return () => clearTimeout(t);
  }, [state]);

  const resumeSaved = async () => {
    if (!saved) return;
    dispatch({ type: "LOAD_PROJECT", state: await restoreProject(saved) });
    setSaved(null);
    setStatus("✓ Session restored");
  };

  const discardSaved = () => {
    setSaved(null);
    void clearSaved().catch(() => {});
  };

  const saveProjectFile = () => {
    const url = URL.createObjectURL(exportProjectBlob(state));
    const a = document.createElement("a");
    a.href = url;
    a.download = `${(state.mixTitle.trim() || "mix").replace(/[/\\:*?"<>|]/g, "_")}.mixproj`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 30_000);
    setStatus("✓ Project saved — open it later to continue this arrangement");
  };

  const openProjectFile = async (file: File) => {
    try {
      dispatch({ type: "LOAD_PROJECT", state: await restoreProject(await readProjectFile(file)) });
      setSaved(null);
      setStatus("✓ Project opened");
    } catch {
      setStatus(`Couldn't open ${file.name} as a Music Mixer project.`);
    }
  };

  // detect each imported file's key timeline once, off the main thread
  const fileIds = JSON.stringify([...new Set(state.clips.map((c) => c.fileId))]);
  useEffect(() => {
    for (const fileId of JSON.parse(fileIds) as string[]) {
      detectKey(fileId)
        .then((segments) => setKeys((k) => (k[fileId] ? k : { ...k, [fileId]: segments })))
        .catch(() => {}); // no key shown for this file
    }
  }, [fileIds]);

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
      setRenderProgress(0);
      ensureProcessed(state.clips, (v) => { if (!stale) setRenderProgress(v); })
        .then(() => {
          if (stale) return;
          setRenderProgress(null);
          setStatus("✓ Tuning complete");
          setProcTick((n) => n + 1);
        })
        .catch(() => {
          if (stale) return;
          setRenderProgress(null);
          setStatus("Tuning failed — try again.");
        });
    }, 300);
    return () => { stale = true; clearTimeout(t); setRenderProgress(null); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [procSig]);

  // the "✓ …complete" note lingers briefly, then clears itself
  useEffect(() => {
    if (!status.startsWith("✓")) return;
    const t = setTimeout(() => setStatus(""), 4000);
    return () => clearTimeout(t);
  }, [status]);

  // structural edits (cuts, moves, speed/pitch, add/remove, enhance) rebuild mid-play
  const structSig =
    JSON.stringify(state.clips.map((c) => [c.fileId, c.start, c.end, c.offset, c.speed, c.pitch, c.env])) +
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
        <label className="upload-label">
          📂 Open project
          <input type="file" accept=".mixproj"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) void openProjectFile(f);
              e.target.value = "";
            }} />
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
      {saved && state.clips.length === 0 && (
        <div className="resume-banner">
          ⏪ Autosaved session from {new Date(saved.savedAt).toLocaleString()} —{" "}
          {saved.state.clips.length} track{saved.state.clips.length === 1 ? "" : "s"}
          {saved.state.mixTitle ? ` · “${saved.state.mixTitle}”` : ""}
          <button className="mode-btn" onClick={() => void resumeSaved()}>▶ Resume</button>
          <button className="mode-btn" onClick={discardSaved}>Discard</button>
        </div>
      )}
      <div className={`status ${status.startsWith("✓") ? "ok" : ""}`}>{status}</div>
      {renderProgress !== null && (
        <div className="render-overlay">
          <div className="render-modal">
            <div className="loader-stage">
              <span className="note n1">♪</span>
              <span className="note n2">♫</span>
              <span className="note n3">♩</span>
              <div className="eq-loader">
                {[0, 1, 2, 3, 4].map((i) => <span key={i} />)}
              </div>
            </div>
            <div className="render-title">Tuning your track…</div>
            <span className="pbar"><span className="pfill" style={{ width: `${Math.round(renderProgress * 100)}%` }} /></span>
            <div className="render-pct">{Math.round(renderProgress * 100)}%</div>
          </div>
        </div>
      )}
      {state.clips.length === 0 ? (
        <div className="hint">Nothing on the timeline yet — open one or more audio files to start cutting.</div>
      ) : (
        <>
          <Timeline clips={state.clips} dispatch={dispatch} position={pos} onSeek={seek}
            previewId={playing ? previewId : null} onPlayTrack={playTrack} keys={keys} />
          <MasterPanel master={state.master} dispatch={dispatch} />
          <div className="mix-controls">
            <input
              type="text"
              placeholder="Mix title (optional)"
              value={state.mixTitle}
              onChange={(e) => dispatch({ type: "SET_TITLE", title: e.target.value })}
            />
            <button className="save-btn" onClick={saveProjectFile}
              title="Download this arrangement + its audio as one .mixproj file — open it later (or on another machine) to keep working">
              💾 Save project
            </button>
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
