import { useReducer, useState } from "react";
import { importFile } from "./audio/files";
import { initialState, reducer } from "./state";
import { fmt, mixLength } from "./utils/time";
import MasterPanel from "./components/MasterPanel";
import ThemePicker from "./components/ThemePicker";
import Timeline from "./components/Timeline";

export default function App() {
  const [state, dispatch] = useReducer(reducer, initialState);
  const [status, setStatus] = useState("");

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

  const total = mixLength(state.clips);

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
        {state.clips.length > 0 && <span className="total">Σ {fmt(total)}</span>}
      </div>
      <div className="status">{status}</div>
      {state.clips.length === 0 ? (
        <div className="hint">Nothing on the timeline yet — open one or more audio files to start cutting.</div>
      ) : (
        <>
          <Timeline clips={state.clips} dispatch={dispatch} />
          <MasterPanel master={state.master} dispatch={dispatch} />
          <div className="mix-controls">
            <input
              type="text"
              placeholder="Mix title (optional)"
              value={state.mixTitle}
              onChange={(e) => dispatch({ type: "SET_TITLE", title: e.target.value })}
            />
            <button disabled title="Rendering & MP3 export land in milestone 3 (see issue #1)">
              Export mix (soon)
            </button>
          </div>
        </>
      )}
    </div>
  );
}
